import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import {
  parseIssueParams,
  formatIssueOutput,
} from "../internal/tool-helpers/issue";
import { enhanceNotFoundError } from "../internal/tool-helpers/enhance-error";
import { ApiNotFoundError } from "../api-client";
import type { SentryApiService } from "../api-client";
import type { Event, Trace } from "../api-client/types";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamIssueShortId,
  ParamIssueUrl,
} from "../schema";

export default defineTool({
  name: "get_issue_details",
  requiredScopes: ["event:read"],
  description: [
    "Get detailed information about a specific Sentry issue by ID.",
    "",
    "🔍 USE THIS TOOL WHEN USERS:",
    "- Provide a specific issue ID (e.g., 'CLOUDFLARE-MCP-41', 'PROJECT-123')",
    "- Ask to 'explain [ISSUE-ID]', 'tell me about [ISSUE-ID]'",
    "- Want details/stacktrace/analysis for a known issue",
    "- Provide a Sentry issue URL",
    "",
    "❌ DO NOT USE for:",
    "- General searching or listing issues (use search_issues)",
    "- Root cause analysis (use analyze_issue_with_seer)",
    "",
    "TRIGGER PATTERNS:",
    "- 'Explain ISSUE-123' → use get_issue_details",
    "- 'Tell me about PROJECT-456' → use get_issue_details",
    "- 'What happened in [issue URL]' → use get_issue_details",
    "",
    "<examples>",
    "### Explain specific issue",
    "```",
    "get_issue_details(organizationSlug='my-organization', issueId='CLOUDFLARE-MCP-41')",
    "```",
    "",
    "### Get details for event ID",
    "```",
    "get_issue_details(organizationSlug='my-organization', eventId='c49541c747cb4d8aa3efb70ca5aba243')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- If the user provides the `issueUrl`, you can ignore the other parameters.",
    "- If the user provides `issueId` or `eventId` (only one is needed), `organizationSlug` is required.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug.optional(),
    regionUrl: ParamRegionUrl.optional(),
    issueId: ParamIssueShortId.optional(),
    eventId: z.string().trim().describe("The ID of the event.").optional(),
    issueUrl: ParamIssueUrl.optional(),
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });

    if (params.eventId) {
      const orgSlug = params.organizationSlug;
      const eventId = params.eventId; // Capture eventId for type safety
      if (!orgSlug) {
        throw new UserInputError(
          "`organizationSlug` is required when providing `eventId`",
        );
      }

      setTag("organization.slug", orgSlug);
      // API client will throw ApiClientError/ApiServerError which the MCP server wrapper handles
      const [issue] = await apiService.listIssues({
        organizationSlug: orgSlug,
        query: eventId,
      });
      if (!issue) {
        return `# Event Not Found\n\nNo issue found for Event ID: ${eventId}`;
      }
      // For this call, we might want to provide context if it fails
      let event: Awaited<ReturnType<typeof apiService.getEventForIssue>>;
      try {
        event = await apiService.getEventForIssue({
          organizationSlug: orgSlug,
          issueId: issue.shortId,
          eventId,
        });
      } catch (error) {
        // Optionally enhance 404 errors with parameter context
        if (error instanceof ApiNotFoundError) {
          throw enhanceNotFoundError(error, {
            organizationSlug: orgSlug,
            issueId: issue.shortId,
            eventId,
          });
        }
        throw error;
      }

      // Try to fetch Seer analysis context (non-blocking)
      let autofixState:
        | Awaited<ReturnType<typeof apiService.getAutofixState>>
        | undefined;
      try {
        autofixState = await apiService.getAutofixState({
          organizationSlug: orgSlug,
          issueId: issue.shortId,
        });
      } catch (error) {
        // Silently continue if Seer analysis is not available
        // This ensures the tool works even if Seer is not enabled
      }

      const performanceTrace = await maybeFetchPerformanceTrace({
        apiService,
        organizationSlug: orgSlug,
        event,
      });

      return formatIssueOutput({
        organizationSlug: orgSlug,
        issue,
        event,
        apiService,
        autofixState,
        performanceTrace,
      });
    }

    // Validate that we have the minimum required parameters
    if (!params.issueUrl && !params.issueId) {
      throw new UserInputError(
        "Either `issueId` or `issueUrl` must be provided",
      );
    }

    if (!params.issueUrl && !params.organizationSlug) {
      throw new UserInputError(
        "`organizationSlug` is required when providing `issueId`",
      );
    }

    const { organizationSlug: orgSlug, issueId: parsedIssueId } =
      parseIssueParams({
        organizationSlug: params.organizationSlug,
        issueId: params.issueId,
        issueUrl: params.issueUrl,
      });

    setTag("organization.slug", orgSlug);

    // For the main issue lookup, provide parameter context on 404
    let issue: Awaited<ReturnType<typeof apiService.getIssue>>;
    try {
      issue = await apiService.getIssue({
        organizationSlug: orgSlug,
        issueId: parsedIssueId!,
      });
    } catch (error) {
      if (error instanceof ApiNotFoundError) {
        throw enhanceNotFoundError(error, {
          organizationSlug: orgSlug,
          issueId: parsedIssueId,
        });
      }
      throw error;
    }

    const event = await apiService.getLatestEventForIssue({
      organizationSlug: orgSlug,
      issueId: issue.shortId,
    });

    // Try to fetch Seer analysis context (non-blocking)
    let autofixState:
      | Awaited<ReturnType<typeof apiService.getAutofixState>>
      | undefined;
    try {
      autofixState = await apiService.getAutofixState({
        organizationSlug: orgSlug,
        issueId: issue.shortId,
      });
    } catch (error) {
      // Silently continue if Seer analysis is not available
      // This ensures the tool works even if Seer is not enabled
    }

    const performanceTrace = await maybeFetchPerformanceTrace({
      apiService,
      organizationSlug: orgSlug,
      event,
    });

    return formatIssueOutput({
      organizationSlug: orgSlug,
      issue,
      event,
      apiService,
      autofixState,
      performanceTrace,
    });
  },
});

async function maybeFetchPerformanceTrace({
  apiService,
  organizationSlug,
  event,
}: {
  apiService: SentryApiService;
  organizationSlug: string;
  event: Event;
}): Promise<Trace | undefined> {
  const context = shouldFetchTraceForEvent(event);
  if (!context) {
    return undefined;
  }

  try {
    return await apiService.getTrace({
      organizationSlug,
      traceId: context.traceId,
      limit: 10000,
      timestamp: context.timestamp,
      errorId: context.eventId,
    });
  } catch (error) {
    console.warn(
      `[get_issue_details] Failed to fetch trace ${context.traceId}:`,
      error,
    );
    return undefined;
  }
}

function shouldFetchTraceForEvent(
  event: Event,
): { traceId: string; timestamp?: number; eventId?: string } | null {
  const occurrence = (event as unknown as { occurrence?: unknown }).occurrence;
  if (!isPotentialNPlusOneOccurrence(occurrence)) {
    return null;
  }

  const evidenceData = (occurrence as { evidenceData?: unknown } | undefined)
    ?.evidenceData;
  if (!evidenceData) {
    return null;
  }

  const parentSpanIds = extractSpanIdArray(
    (evidenceData as { parentSpanIds?: unknown }).parentSpanIds,
  );
  const offenderSpanIds = extractSpanIdArray(
    (evidenceData as { offenderSpanIds?: unknown }).offenderSpanIds,
  );

  if (parentSpanIds.length === 0 && offenderSpanIds.length === 0) {
    return null;
  }

  const traceId = (
    event as unknown as {
      contexts?: { trace?: { trace_id?: unknown } };
    }
  ).contexts?.trace?.trace_id;

  if (typeof traceId !== "string" || traceId.length === 0) {
    return null;
  }

  // Extract timestamp from event (convert to seconds)
  const dateCreated = (event as { dateCreated?: unknown }).dateCreated;
  let timestamp: number | undefined;
  if (typeof dateCreated === "string") {
    const date = new Date(dateCreated);
    if (!Number.isNaN(date.getTime())) {
      timestamp = date.getTime() / 1000; // Convert ms to seconds
    }
  }

  // Extract event ID
  const eventId = (event as { eventID?: unknown }).eventID;
  const errorId = typeof eventId === "string" ? eventId : undefined;

  return { traceId, timestamp, eventId: errorId };
}

function extractSpanIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string" && item.trim().length > 0) {
        return item;
      }
      if (typeof item === "number" && Number.isFinite(item)) {
        return item.toString();
      }
      return undefined;
    })
    .filter((item): item is string => item !== undefined);
}

function isPotentialNPlusOneOccurrence(occurrence: unknown): boolean {
  if (!occurrence || typeof occurrence !== "object") {
    return false;
  }

  const issueType = (occurrence as { issueType?: unknown; type?: unknown })
    .issueType;
  if (typeof issueType === "string") {
    return issueType.includes("n_plus_one");
  }

  const numericType = (occurrence as { type?: unknown }).type;
  if (typeof numericType === "number") {
    return [1006, 1906, 1010, 1910].includes(numericType);
  }

  return false;
}
