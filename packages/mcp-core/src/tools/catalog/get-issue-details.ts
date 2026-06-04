import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { createStructuredOutputSecurity } from "../../internal/structured-output";
import {
  createStructuredToolResult,
  type StructuredToolResult,
} from "../../internal/tool-result";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import {
  parseIssueParams,
  formatIssueOutput,
  assertIssueWithinProjectConstraint,
} from "../../internal/tool-helpers/issue";
import { enhanceNotFoundError } from "../../internal/tool-helpers/enhance-error";
import { ApiNotFoundError } from "../../api-client";
import type { SentryApiService } from "../../api-client";
import type {
  AutofixRunState,
  Event,
  ErrorEvent,
  DefaultEvent,
  TransactionEvent,
  Trace,
  ExternalIssueList,
  Issue,
} from "../../api-client/types";
import { UserInputError } from "../../errors";
import type { ServerContext } from "../../types";
import { logError } from "../../telem/logging";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamIssueShortId,
  ParamIssueUrl,
} from "../../schema";

export default defineTool({
  name: "get_issue_details",
  skills: ["inspect", "triage", "seer"], // Available in inspect, triage, and seer skills
  requiredScopes: ["event:read"],
  description: [
    "Get detailed information about a specific Sentry issue by ID.",
    "",
    "USE THIS TOOL WHEN USERS:",
    "- Provide a specific issue ID (e.g., 'CLOUDFLARE-MCP-41', 'PROJECT-123')",
    "- Ask to 'explain [ISSUE-ID]', 'tell me about [ISSUE-ID]'",
    "- Want details/stacktrace/analysis for a known issue",
    "- Provide a Sentry issue URL",
    "",
    "DO NOT USE for:",
    "- General searching or listing issues (use search_issues)",
    "",
    "TRIGGER PATTERNS:",
    "- 'Explain ISSUE-123' → use get_issue_details",
    "- 'Tell me about PROJECT-456' → use get_issue_details",
    "- 'What happened in [issue URL]' → use get_issue_details",
    "",
    "<examples>",
    "### With Sentry URL (recommended - simplest approach)",
    "```",
    "get_issue_details(issueUrl='https://sentry.sentry.io/issues/6916805731/?project=4509062593708032&query=is%3Aunresolved')",
    "```",
    "",
    "### With issue ID and organization",
    "```",
    "get_issue_details(organizationSlug='my-organization', issueId='CLOUDFLARE-MCP-41')",
    "```",
    "",
    "### With event ID and organization",
    "```",
    "get_issue_details(organizationSlug='my-organization', eventId='c49541c747cb4d8aa3efb70ca5aba243')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- **IMPORTANT**: If user provides a Sentry URL, pass the ENTIRE URL to issueUrl parameter unchanged",
    "- When using issueUrl, all other parameters are automatically extracted - don't provide them separately",
    "- If using issueId (not URL), then organizationSlug is required",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug.optional(),
    regionUrl: ParamRegionUrl.nullable().default(null),
    issueId: ParamIssueShortId.optional(),
    eventId: z.string().trim().describe("The ID of the event.").optional(),
    issueUrl: ParamIssueUrl.optional(),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
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
      // Use issueId directly if provided (e.g., from URL parsing), otherwise search by eventId
      let issue: Awaited<ReturnType<typeof apiService.getIssue>>;
      if (params.issueId) {
        issue = await apiService.getIssue({
          organizationSlug: orgSlug,
          issueId: params.issueId,
        });
      } else {
        const [found] = await apiService.listIssues({
          organizationSlug: orgSlug,
          query: eventId,
        });
        if (!found) {
          return `# Event Not Found\n\nNo issue found for Event ID: ${eventId}`;
        }
        issue = found;
      }
      assertIssueWithinProjectConstraint({
        issue,
        projectSlug: context.constraints.projectSlug,
      });
      // For this call, we might want to provide context if it fails
      const [
        { event, performanceTrace },
        { autofixState, externalIssues, relatedReplayIds },
      ] = await Promise.all([
        apiService
          .getEventForIssue({
            organizationSlug: orgSlug,
            issueId: issue.shortId,
            eventId,
          })
          // Optionally enhance 404 errors with parameter context
          .catch((error) => {
            if (error instanceof ApiNotFoundError) {
              throw enhanceNotFoundError(error, {
                organizationSlug: orgSlug,
                issueId: issue.shortId,
                eventId,
              });
            }
            throw error;
          })
          .then(async (event) => ({
            event,
            performanceTrace: await maybeFetchPerformanceTrace({
              apiService,
              organizationSlug: orgSlug,
              event,
            }),
          })),
        fetchIssueEnrichmentData({
          apiService,
          organizationSlug: orgSlug,
          issue,
        }),
      ]);

      return formatIssueDetailsResult(
        {
          organizationSlug: orgSlug,
          issue,
          event,
          apiService,
          autofixState,
          performanceTrace,
          externalIssues,
          relatedReplayIds,
          experimentalMode: context.experimentalMode,
          availableToolNames: context.availableToolNames,
          directToolNames: context.directToolNames,
        },
        context,
      );
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
    assertIssueWithinProjectConstraint({
      issue,
      projectSlug: context.constraints.projectSlug,
    });

    const [
      { event, performanceTrace },
      { autofixState, externalIssues, relatedReplayIds },
    ] = await Promise.all([
      apiService
        .getLatestEventForIssue({
          organizationSlug: orgSlug,
          issueId: issue.shortId,
        })
        .then(async (event) => ({
          event,
          performanceTrace: await maybeFetchPerformanceTrace({
            apiService,
            organizationSlug: orgSlug,
            event,
          }),
        })),
      fetchIssueEnrichmentData({
        apiService,
        organizationSlug: orgSlug,
        issue,
      }),
    ]);

    return formatIssueDetailsResult(
      {
        organizationSlug: orgSlug,
        issue,
        event,
        apiService,
        autofixState,
        performanceTrace,
        externalIssues,
        relatedReplayIds,
        experimentalMode: context.experimentalMode,
        availableToolNames: context.availableToolNames,
        directToolNames: context.directToolNames,
      },
      context,
    );
  },
});

const ISSUE_DETAILS_STRUCTURED_CONTENT_VERSION = "sentry.mcp.issue_details.v1";

type FormatIssueOutputArgs = Parameters<typeof formatIssueOutput>[0];

function formatIssueDetailsResult(
  args: FormatIssueOutputArgs,
  context: ServerContext,
): string | StructuredToolResult {
  if (!context.experimentalMode) {
    return formatIssueOutput(args);
  }

  return createStructuredToolResult(formatIssueDetailsStructuredContent(args));
}

function formatIssueDetailsStructuredContent({
  organizationSlug,
  issue,
  event,
  apiService,
  autofixState,
  performanceTrace,
  externalIssues,
  relatedReplayIds,
}: FormatIssueOutputArgs) {
  const traceId = getTraceId(event);

  return {
    schemaVersion: ISSUE_DETAILS_STRUCTURED_CONTENT_VERSION,
    security: createStructuredOutputSecurity(),
    meta: {
      organizationSlug,
      projectSlug: issue.project.slug,
    },
    links: {
      issue: apiService.getIssueUrl(organizationSlug, issue.shortId),
      trace: traceId ? apiService.getTraceUrl(organizationSlug, traceId) : null,
      replays: (relatedReplayIds ?? []).map((replayId) =>
        apiService.getReplayUrl(organizationSlug, replayId),
      ),
    },
    issue: {
      id: issue.id,
      shortId: issue.shortId,
      title: issue.title,
      culprit: issue.culprit,
      permalink: issue.permalink,
      project: issue.project,
      platform: issue.platform ?? null,
      status: issue.status,
      substatus: issue.substatus ?? null,
      type: issue.type,
      issueType: issue.issueType ?? null,
      issueCategory: issue.issueCategory ?? null,
      metadata: issue.metadata ?? null,
      assignedTo: issue.assignedTo ?? null,
      seerFixabilityScore: issue.seerFixabilityScore ?? null,
      counts: {
        occurrences: issue.count,
        users: issue.userCount,
      },
      timestamps: {
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen,
      },
    },
    event: {
      id: event.id,
      type: event.type,
      title: event.title,
      message: event.message,
      platform: event.platform ?? null,
      dateCreated: getEventDateCreated(event),
      dateReceived: event.dateReceived ?? null,
      entries: event.entries,
      contexts: event.contexts ?? {},
      context: event.context ?? {},
      tags: event.tags ?? [],
      user: event.user ?? null,
      occurrence: getEventOccurrence(event),
    },
    related: {
      autofixState: autofixState ?? null,
      externalIssues: externalIssues ?? [],
      replayIds: relatedReplayIds ?? [],
      performanceTrace: performanceTrace ?? null,
    },
  };
}

function getEventDateCreated(event: Event): string | null {
  return "dateCreated" in event ? (event.dateCreated ?? null) : null;
}

function getEventOccurrence(event: Event): unknown {
  return "occurrence" in event ? event.occurrence : null;
}

function getTraceId(event: Event): string | null {
  const traceId = event.contexts?.trace?.trace_id;
  return typeof traceId === "string" && traceId.length > 0 ? traceId : null;
}

/**
 * Fetches supplementary data for an issue in parallel: Seer analysis and external links.
 * Both calls are non-blocking -- failures are silently caught so they never
 * prevent the primary issue details from being returned.
 */
async function fetchIssueEnrichmentData({
  apiService,
  organizationSlug,
  issue,
}: {
  apiService: SentryApiService;
  organizationSlug: string;
  issue: Issue;
}): Promise<{
  autofixState: AutofixRunState | undefined;
  externalIssues: ExternalIssueList | undefined;
  relatedReplayIds: string[] | undefined;
}> {
  const issueId = String(issue.id);
  const [autofixState, externalIssues, relatedReplayIds] = await Promise.all([
    apiService
      .getAutofixState({ organizationSlug, issueId: issue.shortId })
      .catch(() => undefined),
    apiService
      .getIssueExternalLinks({ organizationSlug, issueId: issue.shortId })
      .catch(() => undefined),
    apiService
      .listReplayIdsForIssue({
        organizationSlug,
        issueId,
        dataSource: getReplayDataSource(issue),
      })
      .catch(() => undefined),
  ]);

  return { autofixState, externalIssues, relatedReplayIds };
}

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
    });
  } catch (error) {
    logError(error);
    return undefined;
  }
}

function isErrorEvent(event: Event): event is ErrorEvent | DefaultEvent {
  // "default" type represents error events without exception data
  return event.type === "error" || event.type === "default";
}

function isTransactionEvent(event: Event): event is TransactionEvent {
  return event.type === "transaction";
}

function shouldFetchTraceForEvent(event: Event): { traceId: string } | null {
  // Only fetch traces for non-error events (transactions, profiling, etc.)
  if (isErrorEvent(event)) {
    return null;
  }

  // Check if we have a trace ID
  const traceId = event.contexts?.trace?.trace_id;

  if (typeof traceId !== "string" || traceId.length === 0) {
    return null;
  }

  return { traceId };
}

function getReplayDataSource(issue: Issue): "discover" | "search_issues" {
  return issue.issueCategory === "error" || issue.type === "error"
    ? "discover"
    : "search_issues";
}
