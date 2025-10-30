import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import { ParamOrganizationSlug, ParamRegionUrl, ParamTraceId } from "../schema";

// Constants for span filtering and tree rendering
const MAX_DEPTH = 2;
const MINIMUM_DURATION_THRESHOLD_MS = 10;
const MIN_MEANINGFUL_CHILD_DURATION = 5;
const MIN_AVG_DURATION_MS = 5;

export default defineTool({
  name: "get_trace_details",
  requiredSkills: ["inspect"], // Only available in inspect skill
  requiredScopes: ["event:read"],
  description: [
    "Get detailed information about a specific Sentry trace by ID.",
    "",
    "🔍 USE THIS TOOL WHEN USERS:",
    "- Provide a specific trace ID (e.g., 'a4d1aae7216b47ff8117cf4e09ce9d0a')",
    "- Ask to 'show me trace [TRACE-ID]', 'explain trace [TRACE-ID]'",
    "- Want high-level overview and link to view trace details in Sentry",
    "- Need trace statistics and span breakdown",
    "",
    "❌ DO NOT USE for:",
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
    regionUrl: ParamRegionUrl.optional(),
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
      regionUrl: params.regionUrl,
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

interface SelectedSpan {
  event_id: string;
  op: string;
  name: string | null;
  description: string;
  duration: number;
  is_transaction: boolean;
  children: SelectedSpan[];
  level: number;
}

/**
 * Selects a subset of "interesting" spans from a trace for display in the overview.
 *
 * Creates a fake root span representing the entire trace, with selected interesting
 * spans as children. This provides a unified tree view of the trace.
 *
 * The goal is to provide a meaningful sample of the trace that highlights the most
 * important operations while staying within display limits. Selection prioritizes:
 *
 * 1. **Transactions** - Top-level operations that represent complete user requests
 * 2. **Error spans** - Any spans that contain errors (critical for debugging)
 * 3. **Long-running spans** - Operations >= 10ms duration (performance bottlenecks)
 * 4. **Hierarchical context** - Maintains parent-child relationships for understanding
 *
 * Span inclusion rules:
 * - All transactions are included (they're typically root-level operations)
 * - Spans with errors are always included (debugging importance)
 * - Spans with duration >= 10ms are included (performance relevance)
 * - Children are recursively added up to 2 levels deep:
 *   - Transactions can have up to 2 children each
 *   - Regular spans can have up to 1 child each
 * - Total output is capped at maxSpans to prevent overwhelming display
 *
 * @param spans - Complete array of trace spans with nested children
 * @param traceId - Trace ID to display in the fake root span
 * @param maxSpans - Maximum number of spans to include in output (default: 20)
 * @returns Single-element array containing fake root span with selected spans as children
 */
function selectInterestingSpans(
  spans: any[],
  traceId: string,
  maxSpans = 20,
): SelectedSpan[] {
  const selected: SelectedSpan[] = [];
  let spanCount = 0;

  // Filter out non-span items (issues) from the trace data
  // Spans must have children array, duration, and other span-specific fields
  const actualSpans = spans.filter(
    (item) =>
      item &&
      typeof item === "object" &&
      "children" in item &&
      Array.isArray(item.children) &&
      "duration" in item,
  );

  function addSpan(span: any, level: number): boolean {
    if (spanCount >= maxSpans || level > MAX_DEPTH) return false;

    const duration = span.duration || 0;
    const isTransaction = span.is_transaction;
    const hasErrors = span.errors?.length > 0;

    // Always include transactions and spans with errors
    // For regular spans, include if they have reasonable duration or are at root level
    const shouldInclude =
      isTransaction ||
      hasErrors ||
      level === 0 ||
      duration >= MINIMUM_DURATION_THRESHOLD_MS;

    if (!shouldInclude) return false;

    const selectedSpan: SelectedSpan = {
      event_id: span.event_id,
      op: span.op || "unknown",
      name: span.name || null,
      description: span.description || span.transaction || "unnamed",
      duration,
      is_transaction: isTransaction,
      children: [],
      level,
    };

    spanCount++;

    // Add up to one interesting child per span, up to MAX_DEPTH levels deep
    if (level < MAX_DEPTH && span.children?.length > 0) {
      // Sort children by duration (descending) and take the most interesting ones
      const sortedChildren = span.children
        .filter((child: any) => child.duration > MIN_MEANINGFUL_CHILD_DURATION) // Only children with meaningful duration
        .sort((a: any, b: any) => (b.duration || 0) - (a.duration || 0));

      // Add up to 2 children for transactions, 1 for regular spans
      const maxChildren = isTransaction ? 2 : 1;
      let addedChildren = 0;

      for (const child of sortedChildren) {
        if (addedChildren >= maxChildren || spanCount >= maxSpans) break;

        if (addSpan(child, level + 1)) {
          const childSpan = selected[selected.length - 1];
          selectedSpan.children.push(childSpan);
          addedChildren++;
        }
      }
    }

    selected.push(selectedSpan);
    return true;
  }

  // Sort root spans by duration and select the most interesting ones
  const sortedRoots = actualSpans
    .sort((a, b) => (b.duration || 0) - (a.duration || 0))
    .slice(0, 5); // Start with top 5 root spans

  for (const root of sortedRoots) {
    if (spanCount >= maxSpans) break;
    addSpan(root, 0);
  }

  const rootSpans = selected.filter((span) => span.level === 0);

  // Create fake root span representing the entire trace (no duration - traces are unbounded)
  const fakeRoot: SelectedSpan = {
    event_id: traceId,
    op: "trace",
    name: null,
    description: `Trace ${traceId.substring(0, 8)}`,
    duration: 0, // Traces don't have duration
    is_transaction: false,
    children: rootSpans,
    level: -1, // Mark as fake root
  };

  return [fakeRoot];
}

/**
 * Formats a span display name for the tree view.
 *
 * Uses span.name if available (OTEL-native), otherwise falls back to span.description.
 *
 * @param span - The span to format
 * @returns A formatted display name for the span
 */
function formatSpanDisplayName(span: SelectedSpan): string {
  // For the fake trace root, just return "trace"
  if (span.op === "trace") {
    return "trace";
  }

  // Use span.name if available (OTEL-native), otherwise use description
  return span.name?.trim() || span.description || "unnamed";
}

/**
 * Renders a hierarchical tree structure of spans using Unicode box-drawing characters.
 *
 * Creates a visual tree representation showing parent-child relationships between spans,
 * with proper indentation and connecting lines. Each span shows its operation, short ID,
 * description, duration, and type (transaction vs span).
 *
 * Tree format:
 * - Root spans have no prefix
 * - Child spans use ├─ for intermediate children, └─ for last child
 * - Continuation lines use │ for vertical connections
 * - Proper spacing maintains visual alignment
 *
 * @param spans - Array of selected spans with their nested children structure
 * @returns Array of formatted markdown strings representing the tree structure
 */
function renderSpanTree(spans: SelectedSpan[]): string[] {
  const lines: string[] = [];

  function renderSpan(span: SelectedSpan, prefix = "", isLast = true): void {
    const shortId = span.event_id.substring(0, 8);
    const connector = prefix === "" ? "" : isLast ? "└─ " : "├─ ";
    const displayName = formatSpanDisplayName(span);

    // Don't show duration for the fake trace root span
    if (span.op === "trace") {
      lines.push(`${prefix}${connector}${displayName} [${shortId}]`);
    } else {
      const duration = span.duration
        ? `${Math.round(span.duration)}ms`
        : "unknown";

      // Don't show 'default' operations as they're not meaningful
      const opDisplay = span.op === "default" ? "" : ` · ${span.op}`;
      lines.push(
        `${prefix}${connector}${displayName} [${shortId}${opDisplay} · ${duration}]`,
      );
    }

    // Render children with proper tree indentation
    for (let i = 0; i < span.children.length; i++) {
      const child = span.children[i];
      const isLastChild = i === span.children.length - 1;
      const childPrefix = prefix + (isLast ? "   " : "│  ");
      renderSpan(child, childPrefix, isLastChild);
    }
  }

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const isLastRoot = i === spans.length - 1;
    renderSpan(span, "", isLastRoot);
  }

  return lines;
}

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

function getAllSpansFlattened(spans: any[]): any[] {
  const result: any[] = [];

  // Filter out non-span items (issues) from the trace data
  // Spans must have children array and duration
  const actualSpans = spans.filter(
    (item) =>
      item &&
      typeof item === "object" &&
      "children" in item &&
      Array.isArray(item.children) &&
      "duration" in item,
  );

  function collectSpans(spanList: any[]) {
    for (const span of spanList) {
      result.push(span);
      if (span.children && span.children.length > 0) {
        collectSpans(span.children);
      }
    }
  }

  collectSpans(actualSpans);
  return result;
}

function formatTraceOutput({
  organizationSlug,
  traceId,
  traceMeta,
  trace,
  apiService,
}: {
  organizationSlug: string;
  traceId: string;
  traceMeta: any;
  trace: any[];
  apiService: any;
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
  sections.push(`Use this search query to find all events in this trace:`);
  sections.push("```");
  sections.push(`trace:${traceId}`);
  sections.push("```");
  sections.push("");
  sections.push(
    "You can use this query with the `search_events` tool to get detailed event data from this trace.",
  );

  return sections.join("\n");
}
