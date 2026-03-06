import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import { ParamOrganizationSlug, ParamRegionUrl, ParamTraceId } from "../schema";
import {
  MIN_AVG_DURATION_MS,
  selectInterestingSpans,
  getAllSpansFlattened,
  renderSpanTree,
} from "../internal/tool-helpers/trace-rendering";
import { getEventsToolName } from "../internal/tool-helpers/tool-names";

export default defineTool({
  name: "get_trace_details",
  skills: ["inspect"], // Only available in inspect skill
  requiredScopes: ["event:read"],
  requiredCapabilities: ["traces"],
  hideInExperimentalMode: true, // Replaced by get_sentry_resource in experimental mode
  description: [
    "Get detailed information about a specific Sentry trace by ID.",
    "",
    "USE THIS TOOL WHEN USERS:",
    "- Provide a specific trace ID (e.g., 'a4d1aae7216b47ff8117cf4e09ce9d0a')",
    "- Ask to 'show me trace [TRACE-ID]', 'explain trace [TRACE-ID]'",
    "- Want high-level overview and link to view trace details in Sentry",
    "- Need trace statistics and span breakdown",
    "",
    "DO NOT USE for:",
    "- General searching for traces (use search_events with trace queries)",
    "- Individual span details (this shows trace overview)",
    "",
    "TRIGGER PATTERNS:",
    "- 'Show me trace abc123' → use get_trace_details",
    "- 'Explain trace a4d1aae7216b47ff8117cf4e09ce9d0a' → use get_trace_details",
    "- 'What is trace [trace-id]' → use get_trace_details",
    "",
    "<examples>",
    "### Get trace overview",
    "```",
    "get_trace_details(organizationSlug='my-organization', traceId='a4d1aae7216b47ff8117cf4e09ce9d0a')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- Trace IDs are 32-character hexadecimal strings",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    traceId: ParamTraceId,
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    // Validate trace ID format
    if (!/^[0-9a-fA-F]{32}$/.test(params.traceId)) {
      throw new UserInputError(
        "Trace ID must be a 32-character hexadecimal string",
      );
    }

    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });

    setTag("organization.slug", params.organizationSlug);
    setTag("trace.id", params.traceId);

    // Get trace metadata for overview
    const traceMeta = await apiService.getTraceMeta({
      organizationSlug: params.organizationSlug,
      traceId: params.traceId,
      statsPeriod: "14d", // Fixed stats period
    });

    // Get minimal trace data to show key transactions
    const trace = await apiService.getTrace({
      organizationSlug: params.organizationSlug,
      traceId: params.traceId,
      limit: 10, // Only get top-level spans for overview
      statsPeriod: "14d", // Fixed stats period
    });

    return formatTraceOutput({
      organizationSlug: params.organizationSlug,
      traceId: params.traceId,
      traceMeta,
      trace,
      apiService,
    });
  },
});

function calculateOperationStats(spans: any[]): Record<
  string,
  {
    count: number;
    avgDuration: number;
    p95Duration: number;
  }
> {
  const allSpans = getAllSpansFlattened(spans);
  const operationSpans: Record<string, any[]> = {};

  // Group leaf spans by operation type (only spans with no children)
  for (const span of allSpans) {
    // Only consider leaf nodes - spans that have no children
    if (!span.children || span.children.length === 0) {
      // Use span.op if available, otherwise extract from span.name, fallback to "unknown"
      const op = span.op || (span.name ? span.name.split(" ")[0] : "unknown");
      if (!operationSpans[op]) {
        operationSpans[op] = [];
      }
      operationSpans[op].push(span);
    }
  }

  const stats: Record<
    string,
    { count: number; avgDuration: number; p95Duration: number }
  > = {};

  // Calculate stats for each operation
  for (const [op, opSpans] of Object.entries(operationSpans)) {
    const durations = opSpans
      .map((span) => span.duration || 0)
      .filter((duration) => duration > 0)
      .sort((a, b) => a - b);

    const count = opSpans.length;
    const avgDuration =
      durations.length > 0
        ? durations.reduce((sum, duration) => sum + duration, 0) /
          durations.length
        : 0;

    // Calculate P95 (95th percentile)
    const p95Index = Math.floor(durations.length * 0.95);
    const p95Duration = durations.length > 0 ? durations[p95Index] || 0 : 0;

    stats[op] = {
      count,
      avgDuration,
      p95Duration,
    };
  }

  return stats;
}

export function formatTraceOutput({
  organizationSlug,
  traceId,
  traceMeta,
  trace,
  apiService,
  suggestSpansResource = false,
}: {
  organizationSlug: string;
  traceId: string;
  traceMeta: any;
  trace: any[];
  apiService: any;
  suggestSpansResource?: boolean;
}): string {
  const sections: string[] = [];

  // Header
  sections.push(`# Trace \`${traceId}\` in **${organizationSlug}**`);
  sections.push("");

  // High-level statistics
  sections.push("## Summary");
  sections.push("");
  sections.push(`**Total Spans**: ${traceMeta.span_count}`);
  sections.push(`**Errors**: ${traceMeta.errors}`);
  sections.push(`**Performance Issues**: ${traceMeta.performance_issues}`);
  sections.push(`**Logs**: ${traceMeta.logs}`);

  // Show operation breakdown with detailed stats if we have trace data
  if (trace.length > 0) {
    const operationStats = calculateOperationStats(trace);
    const sortedOps = Object.entries(operationStats)
      .filter(([, stats]) => stats.avgDuration >= MIN_AVG_DURATION_MS) // Only show ops with avg duration >= 5ms
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10); // Show top 10

    if (sortedOps.length > 0) {
      sections.push("");
      sections.push("## Operation Breakdown");
      sections.push("");

      for (const [op, stats] of sortedOps) {
        const avgDuration = Math.round(stats.avgDuration);
        const p95Duration = Math.round(stats.p95Duration);
        sections.push(
          `- **${op}**: ${stats.count} spans (avg: ${avgDuration}ms, p95: ${p95Duration}ms)`,
        );
      }
      sections.push("");
    }
  }

  // Show span tree structure
  if (trace.length > 0) {
    const selectedSpans = selectInterestingSpans(trace, traceId);

    if (selectedSpans.length > 0) {
      sections.push("## Overview");
      sections.push("");
      const treeLines = renderSpanTree(selectedSpans);
      sections.push(...treeLines);
      sections.push("");
      sections.push(
        "*Note: This shows a subset of spans. View the full trace for complete details.*",
      );
      sections.push("");
    }
  }

  // Links and usage information
  const traceUrl = apiService.getTraceUrl(organizationSlug, traceId);
  sections.push("## View Full Trace");
  sections.push("");
  sections.push(`**Sentry URL**: ${traceUrl}`);
  sections.push("");
  sections.push("## Find Related Events");
  sections.push("");

  if (suggestSpansResource) {
    sections.push(
      "To view the complete span tree for this trace, use `get_sentry_resource`:",
    );
    sections.push("```");
    sections.push(
      `get_sentry_resource(resourceType='spans', organizationSlug='${organizationSlug}', resourceId='${traceId}')`,
    );
    sections.push("```");
  } else {
    const eventsToolName = getEventsToolName();
    sections.push(
      `To list all spans in this trace, use \`${eventsToolName}\` with cursor pagination:`,
    );
    sections.push("```");
    sections.push(
      `${eventsToolName}(organizationSlug='${organizationSlug}', dataset='spans', query='trace:${traceId}', sort='-timestamp', limit=100)`,
    );
    sections.push("```");
    sections.push(
      "Use the returned `cursor` value to fetch subsequent pages until all spans are retrieved.",
    );
  }

  return sections.join("\n");
}
