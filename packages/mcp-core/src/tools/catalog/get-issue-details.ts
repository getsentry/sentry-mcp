import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import {
  createStructuredDataPreview,
  createStructuredOutputSecurity,
  StructuredDataPreviewSchema,
  StructuredOutputSecuritySchema,
} from "../../internal/structured-output";
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
  TraceSpan,
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
import { formatEventValue } from "../support/search-events/utils";

const ISSUE_DETAILS_STRUCTURED_CONTENT_VERSION = "sentry.mcp.issue_details.v1";
const STRUCTURED_EVENT_ENTRIES_LIMIT = 12;
const STRUCTURED_TRACE_ROOT_LIMIT = 5;
const STRUCTURED_TRACE_CHILD_LIMIT = 5;
const STRUCTURED_TRACE_DEPTH_LIMIT = 2;
const STRUCTURED_AUTOFIX_ARRAY_LIMIT = 10;
const STRUCTURED_AUTOFIX_OBJECT_KEY_LIMIT = 20;
const STRUCTURED_AUTOFIX_DEPTH_LIMIT = 3;
const STRUCTURED_EVENT_FIELD_LIMIT = 40;
const STRUCTURED_EVENT_FIELD_VALUE_LIMIT = 500;
const STRUCTURED_KNOWN_CONTEXT_NAMES = new Set([
  "app",
  "browser",
  "client_os",
  "cloud_resource",
  "culture",
  "device",
  "gpu",
  "os",
  "profile",
  "replay",
  "response",
  "runtime",
  "trace",
]);

const structuredRenderedFieldSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const structuredNamedFieldGroupSchema = z.object({
  name: z.string(),
  fields: z.array(structuredRenderedFieldSchema),
});

const structuredTagSchema = z.object({
  key: z.string(),
  value: z.string(),
});

const structuredEntrySchema = z.object({
  type: z.string(),
  value: z.string(),
});

const structuredUserSchema = z.object({
  id: z.string().nullable(),
  email: z.string().nullable(),
  username: z.string().nullable(),
  ipAddress: z.string().nullable(),
  displayName: z.string().nullable(),
  geo: z.string().nullable(),
});

const structuredExternalIssueSchema = z.object({
  displayName: z.string(),
  serviceType: z.string(),
  url: z.string(),
});

const structuredProjectSchema = z.object({
  slug: z.string(),
  name: z.string(),
  platform: z.string().nullable(),
});

const structuredIssueMetadataSchema = z.object({
  title: z.string().nullable(),
  location: z.string().nullable(),
  value: z.string().nullable(),
});

const issueDetailsSuccessStructuredOutputSchema = z.object({
  schemaVersion: z.literal(ISSUE_DETAILS_STRUCTURED_CONTENT_VERSION),
  security: StructuredOutputSecuritySchema,
  meta: z.object({
    organizationSlug: z.string(),
    projectSlug: z.string(),
  }),
  links: z.object({
    issue: z.string(),
    trace: z.string().nullable(),
    replays: z.array(z.string()),
  }),
  issue: z.object({
    id: z.unknown(),
    shortId: z.string(),
    title: z.string(),
    culprit: z.unknown(),
    permalink: z.unknown(),
    project: structuredProjectSchema,
    platform: z.string().nullable(),
    status: z.unknown(),
    substatus: z.unknown().nullable(),
    type: z.unknown(),
    issueType: z.unknown().nullable(),
    issueCategory: z.unknown().nullable(),
    metadata: structuredIssueMetadataSchema,
    assignedTo: z.unknown().nullable(),
    seerFixabilityScore: z.unknown().nullable(),
    counts: z.object({
      occurrences: z.unknown(),
      users: z.unknown(),
    }),
    timestamps: z.object({
      firstSeen: z.unknown(),
      lastSeen: z.unknown(),
    }),
  }),
  event: z.object({
    id: z.string(),
    type: z.unknown(),
    title: z.string(),
    message: z.unknown(),
    platform: z.string().nullable(),
    dateCreated: z.string().nullable(),
    dateReceived: z.string().nullable(),
    entries: z.object({
      data: z.array(structuredEntrySchema),
      truncated: z.boolean(),
    }),
    contexts: z.object({
      data: z.array(structuredNamedFieldGroupSchema),
      truncated: z.boolean(),
    }),
    context: z.object({
      data: z.array(structuredRenderedFieldSchema),
      truncated: z.boolean(),
    }),
    tags: z.object({
      data: z.array(structuredTagSchema),
      truncated: z.boolean(),
    }),
    user: z.object({
      data: structuredUserSchema.nullable(),
      truncated: z.boolean(),
    }),
    occurrence: z.object({
      data: z.array(structuredRenderedFieldSchema),
      truncated: z.boolean(),
    }),
  }),
  related: z.object({
    autofixState: StructuredDataPreviewSchema,
    externalIssues: z.array(structuredExternalIssueSchema),
    replayIds: z.array(z.string()),
    performanceTrace: z.unknown().nullable(),
  }),
});

const issueDetailsNotFoundStructuredOutputSchema = z.object({
  schemaVersion: z.literal(ISSUE_DETAILS_STRUCTURED_CONTENT_VERSION),
  security: StructuredOutputSecuritySchema,
  status: z.literal("not_found"),
  reason: z.literal("event_not_found"),
  meta: z.object({
    organizationSlug: z.string(),
    projectSlug: z.string().nullable(),
  }),
  links: z.object({
    issue: z.null(),
    trace: z.null(),
    replays: z.array(z.string()),
  }),
  eventId: z.string(),
  message: z.string(),
});

const issueDetailsStructuredOutputSchema = z.union([
  issueDetailsSuccessStructuredOutputSchema,
  issueDetailsNotFoundStructuredOutputSchema,
]);

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
  outputSchema: ({ experimentalMode }) =>
    experimentalMode ? issueDetailsStructuredOutputSchema : undefined,
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
          return formatIssueEventNotFoundResult({
            organizationSlug: orgSlug,
            projectSlug: context.constraints.projectSlug ?? null,
            eventId,
            context,
          });
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

type FormatIssueOutputArgs = Parameters<typeof formatIssueOutput>[0];

function formatIssueEventNotFoundResult({
  organizationSlug,
  projectSlug,
  eventId,
  context,
}: {
  organizationSlug: string;
  projectSlug: string | null;
  eventId: string;
  context: ServerContext;
}): string | StructuredToolResult {
  const message = `No issue found for Event ID: ${eventId}`;

  if (!context.experimentalMode) {
    return `# Event Not Found\n\n${message}`;
  }

  return createStructuredToolResult({
    schemaVersion: ISSUE_DETAILS_STRUCTURED_CONTENT_VERSION,
    security: createStructuredOutputSecurity(),
    status: "not_found",
    reason: "event_not_found",
    meta: {
      organizationSlug,
      projectSlug,
    },
    links: {
      issue: null,
      trace: null,
      replays: [],
    },
    eventId,
    message,
  });
}

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
      project: formatStructuredProject(issue.project),
      platform: issue.platform ?? null,
      status: issue.status,
      substatus: issue.substatus ?? null,
      type: issue.type,
      issueType: issue.issueType ?? null,
      issueCategory: issue.issueCategory ?? null,
      metadata: formatStructuredIssueMetadata(issue.metadata),
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
      entries: createStructuredEntryRows(event.entries ?? []),
      contexts: createStructuredNamedObjectRows(event.contexts ?? {}),
      context: createStructuredFieldRows(event.context ?? {}),
      tags: createStructuredTagRows(event.tags ?? []),
      user: createStructuredUser(event.user ?? null),
      occurrence: createStructuredFieldRows(getEventOccurrence(event)),
    },
    related: {
      autofixState: createStructuredDataPreview(autofixState ?? null, {
        arrayLimit: STRUCTURED_AUTOFIX_ARRAY_LIMIT,
        objectKeyLimit: STRUCTURED_AUTOFIX_OBJECT_KEY_LIMIT,
        depthLimit: STRUCTURED_AUTOFIX_DEPTH_LIMIT,
      }),
      externalIssues: formatStructuredExternalIssues(externalIssues),
      replayIds: relatedReplayIds ?? [],
      performanceTrace: summarizePerformanceTrace(performanceTrace),
    },
  };
}

function formatStructuredProject(
  project: Issue["project"],
): z.infer<typeof structuredProjectSchema> {
  return {
    slug: project.slug,
    name: project.name,
    platform: project.platform ?? null,
  };
}

function formatStructuredIssueMetadata(
  metadata: Issue["metadata"] | undefined,
): z.infer<typeof structuredIssueMetadataSchema> {
  return {
    title: formatNullableStructuredValue(metadata?.title),
    location: formatNullableStructuredValue(metadata?.location),
    value: formatNullableStructuredValue(metadata?.value),
  };
}

function formatNullableStructuredValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return formatEventValue(value, {
    maxLength: STRUCTURED_EVENT_FIELD_VALUE_LIMIT,
  });
}

function createStructuredFieldRows(value: unknown): {
  data: Array<{ name: string; value: string }>;
  truncated: boolean;
} {
  if (!isRecord(value)) {
    return { data: [], truncated: value != null };
  }

  const entries = Object.entries(value).filter(
    ([, entryValue]) => entryValue !== null && entryValue !== undefined,
  );
  return {
    data: entries
      .slice(0, STRUCTURED_EVENT_FIELD_LIMIT)
      .map(([name, data]) => ({
        name,
        value: formatEventValue(data, {
          maxLength: STRUCTURED_EVENT_FIELD_VALUE_LIMIT,
        }),
      })),
    truncated: entries.length > STRUCTURED_EVENT_FIELD_LIMIT,
  };
}

function createStructuredEntryRows(entries: Event["entries"]): {
  data: Array<{ type: string; value: string }>;
  truncated: boolean;
} {
  const entryRows = (entries ?? []).map((entry) => ({
    type: entry.type,
    value: formatEventValue(entry.data, {
      maxLength: STRUCTURED_EVENT_FIELD_VALUE_LIMIT,
    }),
  }));

  return {
    data: entryRows.slice(0, STRUCTURED_EVENT_ENTRIES_LIMIT),
    truncated: entryRows.length > STRUCTURED_EVENT_ENTRIES_LIMIT,
  };
}

function createStructuredNamedObjectRows(value: unknown): {
  data: Array<{
    name: string;
    fields: Array<{ name: string; value: string }>;
  }>;
  truncated: boolean;
} {
  if (!isRecord(value)) {
    return { data: [], truncated: value != null };
  }

  const entries = Object.entries(value);
  let childTruncated = false;
  const rows = entries
    .slice(0, STRUCTURED_EVENT_FIELD_LIMIT)
    .map(([name, data]) => {
      if (!STRUCTURED_KNOWN_CONTEXT_NAMES.has(name)) {
        return createStructuredCustomContextRow(name, data);
      }

      const fields = createStructuredFieldRows(data);
      childTruncated = childTruncated || fields.truncated;

      return {
        name,
        fields: fields.data.filter((field) => field.name !== "type"),
      };
    });

  return {
    data: rows,
    truncated: entries.length > STRUCTURED_EVENT_FIELD_LIMIT || childTruncated,
  };
}

function createStructuredCustomContextRow(
  name: string,
  data: unknown,
): {
  name: string;
  fields: Array<{ name: string; value: string }>;
} {
  return {
    name: "custom_context",
    fields: [
      {
        name: "context.name",
        value: formatEventValue(name, {
          maxLength: STRUCTURED_EVENT_FIELD_VALUE_LIMIT,
        }),
      },
      {
        name: "context.value",
        value: formatEventValue(data, {
          maxLength: STRUCTURED_EVENT_FIELD_VALUE_LIMIT,
        }),
      },
    ],
  };
}

function createStructuredTagRows(tags: Event["tags"]): {
  data: Array<{ key: string; value: string }>;
  truncated: boolean;
} {
  const tagRows = (tags ?? []).map((tag) => ({
    key: tag.key,
    value: formatEventValue(tag.value, {
      maxLength: STRUCTURED_EVENT_FIELD_VALUE_LIMIT,
    }),
  }));

  return {
    data: tagRows.slice(0, STRUCTURED_EVENT_FIELD_LIMIT),
    truncated: tagRows.length > STRUCTURED_EVENT_FIELD_LIMIT,
  };
}

function createStructuredUser(user: Event["user"] | null): {
  data: z.infer<typeof structuredUserSchema> | null;
  truncated: boolean;
} {
  if (!user || Object.keys(user).length === 0) {
    return { data: null, truncated: false };
  }

  return {
    data: {
      id: user.id ?? null,
      email: user.email ?? null,
      username: user.username ?? null,
      ipAddress: user.ip_address ?? user.ip ?? null,
      displayName: user.display_name ?? user.name ?? null,
      geo: user.geo
        ? formatEventValue(user.geo, {
            maxLength: STRUCTURED_EVENT_FIELD_VALUE_LIMIT,
          })
        : null,
    },
    truncated: false,
  };
}

function formatStructuredExternalIssues(
  externalIssues: ExternalIssueList | undefined,
): Array<z.infer<typeof structuredExternalIssueSchema>> {
  return (externalIssues ?? []).map((externalIssue) => ({
    displayName: externalIssue.displayName,
    serviceType: externalIssue.serviceType,
    url: externalIssue.webUrl,
  }));
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

function summarizePerformanceTrace(trace: Trace | undefined) {
  if (!trace) {
    return null;
  }

  const counts = countTraceNodes(trace);
  const rootPreview = trace
    .slice(0, STRUCTURED_TRACE_ROOT_LIMIT)
    .map((node) => summarizeTraceNode(node, 0));
  const truncated =
    trace.length > STRUCTURED_TRACE_ROOT_LIMIT ||
    rootPreview.some((node) => node.truncated);

  return {
    rootCount: trace.length,
    spanCount: counts.spanCount,
    issueCount: counts.issueCount,
    truncated,
    rootPreview,
  };
}

function countTraceNodes(trace: Trace): {
  spanCount: number;
  issueCount: number;
} {
  const stack: unknown[] = [...trace];
  let spanCount = 0;
  let issueCount = 0;

  while (stack.length > 0) {
    const node = stack.pop();
    if (isTraceSpanNode(node)) {
      spanCount += 1;
      stack.push(...(node.children as unknown[]));
    } else if (node) {
      issueCount += 1;
    }
  }

  return { spanCount, issueCount };
}

function summarizeTraceNode(
  node: unknown,
  depth: number,
): Record<string, unknown> & { truncated: boolean } {
  if (!isTraceSpanNode(node)) {
    return summarizeTraceIssue(node);
  }

  const children = node.children as unknown[];
  const childCount = children.length;
  const canIncludeChildren = depth < STRUCTURED_TRACE_DEPTH_LIMIT;
  const childPreview = canIncludeChildren
    ? children
        .slice(0, STRUCTURED_TRACE_CHILD_LIMIT)
        .map((child: unknown) => summarizeTraceNode(child, depth + 1))
    : [];
  const truncated =
    (canIncludeChildren && childCount > STRUCTURED_TRACE_CHILD_LIMIT) ||
    (!canIncludeChildren && childCount > 0) ||
    childPreview.some((child) => child.truncated);

  return {
    type: "span",
    spanId: node.span_id ?? null,
    eventId: node.event_id,
    transactionId: node.transaction_id,
    projectSlug: node.project_slug,
    operation: node.op ?? null,
    description: node.description ?? node.name ?? node.transaction ?? null,
    duration: node.duration,
    status: node.status ?? null,
    startTimestamp: node.start_timestamp,
    endTimestamp: node.end_timestamp,
    childCount,
    childPreview,
    truncated,
  };
}

function summarizeTraceIssue(
  node: unknown,
): Record<string, unknown> & { truncated: boolean } {
  if (!isRecord(node)) {
    return {
      type: "issue",
      truncated: true,
    };
  }

  return {
    type: "issue",
    id: getRecordValue(node, "id"),
    issueId: getRecordValue(node, "issue_id"),
    projectSlug: getRecordValue(node, "project_slug"),
    title: getRecordValue(node, "title"),
    culprit: getRecordValue(node, "culprit"),
    timestamp: getRecordValue(node, "timestamp"),
    truncated: false,
  };
}

function isTraceSpanNode(node: unknown): node is TraceSpan {
  return (
    isRecord(node) &&
    Array.isArray(node.children) &&
    typeof node.event_id === "string" &&
    typeof node.transaction_id === "string" &&
    typeof node.duration === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecordValue(record: Record<string, unknown>, key: string): unknown {
  return record[key] ?? null;
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
