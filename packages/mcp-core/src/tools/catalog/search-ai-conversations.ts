import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { createStructuredTextResult } from "../../internal/tool-helpers/results";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamProjectSlug,
} from "../../schema";
import { UserInputError } from "../../errors";
import { isNumericId } from "../../utils/slug-validation";
import {
  AIConversationSummarySchema,
  type AIConversationSummary,
  type SentryApiService,
} from "../../api-client";
import type { ServerContext } from "../../types";

const SORT_VALUES = [
  "timestamp",
  "-timestamp",
  "duration",
  "-duration",
  "errors",
  "-errors",
  "llmCalls",
  "-llmCalls",
  "toolCalls",
  "-toolCalls",
  "totalTokens",
  "-totalTokens",
  "totalCost",
  "-totalCost",
  "toolErrors",
  "-toolErrors",
] as const;

const SAMPLING_MODES = [
  "NORMAL",
  "HIGHEST_ACCURACY",
  "HIGHEST_ACCURACY_FLEX_TIME",
] as const;

const aiConversationSearchResultSchema = AIConversationSummarySchema.extend({
  url: z.string().url(),
  durationMs: z.number(),
});

export const searchAIConversationsOutputSchema = z.object({
  organizationSlug: z.string(),
  count: z.number(),
  nextCursor: z.string().nullable(),
  conversations: z.array(aiConversationSearchResultSchema),
});

type SearchAIConversationsOutput = z.infer<
  typeof searchAIConversationsOutputSchema
>;

function normalizeList<T>(value: T | T[] | null | undefined): T[] | undefined {
  if (value == null) {
    return undefined;
  }
  return Array.isArray(value) ? value : [value];
}

async function resolveProjectIds({
  apiService,
  organizationSlug,
  project,
  constrainedProjectSlug,
}: {
  apiService: SentryApiService;
  organizationSlug: string;
  project?: string | string[];
  constrainedProjectSlug?: string | null;
}): Promise<string[] | undefined> {
  if (constrainedProjectSlug) {
    const constrainedProject = await apiService.getProject({
      organizationSlug,
      projectSlugOrId: constrainedProjectSlug,
    });
    return [String(constrainedProject.id)];
  }

  const projects = normalizeList(project);
  if (!projects || projects.length === 0) {
    return undefined;
  }

  return Promise.all(
    projects.map(async (projectSlugOrId) => {
      if (projectSlugOrId === "-1" || isNumericId(projectSlugOrId)) {
        return projectSlugOrId;
      }
      const resolvedProject = await apiService.getProject({
        organizationSlug,
        projectSlugOrId,
      });
      return String(resolvedProject.id);
    }),
  );
}

function formatTimestamp(timestampMs: number): string {
  return timestampMs > 0 ? new Date(timestampMs).toISOString() : "Unknown";
}

function formatDuration(startTimestampMs: number, endTimestampMs: number) {
  const durationMs = Math.max(0, endTimestampMs - startTimestampMs);
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`;
  }
  const minutes = seconds / 60;
  return `${minutes.toFixed(minutes % 1 === 0 ? 0 : 1)}m`;
}

function truncate(value: string | null | undefined, maxLength = 280): string {
  if (!value) {
    return "None";
  }
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 3)}...`;
}

function formatUser(conversation: AIConversationSummary): string {
  const user = conversation.user;
  if (!user) {
    return "Unknown";
  }
  return user.email ?? user.username ?? user.id ?? user.ip_address ?? "Unknown";
}

function buildArtifact(
  apiService: SentryApiService,
  organizationSlug: string,
  conversations: AIConversationSummary[],
  nextCursor: string | null,
): SearchAIConversationsOutput {
  return {
    organizationSlug,
    count: conversations.length,
    nextCursor,
    conversations: conversations.map((conversation) => ({
      ...conversation,
      url: apiService.getAIConversationUrl(
        organizationSlug,
        conversation.conversationId,
      ),
      durationMs: Math.max(
        0,
        conversation.endTimestamp - conversation.startTimestamp,
      ),
    })),
  };
}

function formatConversation(
  apiService: SentryApiService,
  organizationSlug: string,
  conversation: AIConversationSummary,
): string {
  const url = apiService.getAIConversationUrl(
    organizationSlug,
    conversation.conversationId,
  );
  const details = [
    `## ${conversation.conversationId}`,
    "",
    `**URL**: ${url}`,
    `**Started**: ${formatTimestamp(conversation.startTimestamp)}`,
    `**Ended**: ${formatTimestamp(conversation.endTimestamp)}`,
    `**Duration**: ${formatDuration(conversation.startTimestamp, conversation.endTimestamp)}`,
    `**User**: ${formatUser(conversation)}`,
    `**Errors**: ${conversation.errors}`,
    `**LLM Calls**: ${conversation.llmCalls}`,
    `**Tool Calls**: ${conversation.toolCalls}`,
    `**Tool Errors**: ${conversation.toolErrors}`,
    `**Total Tokens**: ${conversation.totalTokens}`,
    `**Total Cost**: ${conversation.totalCost}`,
    `**Trace Count**: ${conversation.traceCount}`,
  ];

  if (conversation.flow.length > 0) {
    details.push(`**Flow**: ${conversation.flow.join(" -> ")}`);
  }
  if (conversation.toolNames.length > 0) {
    details.push(`**Tools**: ${conversation.toolNames.join(", ")}`);
  }
  if (conversation.traceIds.length > 0) {
    details.push(`**Trace IDs**: ${conversation.traceIds.join(", ")}`);
  }

  details.push(
    "",
    "**First Input**",
    "",
    truncate(conversation.firstInput),
    "",
    "**Last Output**",
    "",
    truncate(conversation.lastOutput),
    "",
  );

  return details.join("\n");
}

function formatExecutedSearch(params: {
  query?: string | null;
  sort?: string | null;
  projectIds?: string[];
  environment?: string | string[] | null;
  statsPeriod?: string | null;
  start?: string | null;
  end?: string | null;
  limit: number;
  cursor?: string | null;
  samplingMode?: string | null;
}) {
  const lines = [
    "## Executed Search",
    `- Query: \`${params.query || "(empty)"}\``,
    `- Sort: \`${params.sort || "-timestamp"}\``,
    `- Limit: ${params.limit}`,
  ];

  if (params.projectIds && params.projectIds.length > 0) {
    lines.push(
      `- Projects: ${params.projectIds.map((id) => `\`${id}\``).join(", ")}`,
    );
  }
  const environments = normalizeList(params.environment);
  if (environments && environments.length > 0) {
    lines.push(
      `- Environments: ${environments.map((env) => `\`${env}\``).join(", ")}`,
    );
  }
  if (params.start || params.end) {
    lines.push(
      `- Time range: ${params.start || "(unspecified start)"} to ${params.end || "(unspecified end)"}`,
    );
  } else if (params.statsPeriod) {
    lines.push(`- Time range: Last ${params.statsPeriod}`);
  }
  if (params.cursor) {
    lines.push(`- Cursor: \`${params.cursor}\``);
  }
  if (params.samplingMode) {
    lines.push(`- Sampling mode: \`${params.samplingMode}\``);
  }

  return `${lines.join("\n")}\n`;
}

export default defineTool({
  name: "search_ai_conversations",
  skills: ["inspect", "triage", "seer"],
  requiredScopes: ["event:read", "project:read"],
  description: [
    "Search Sentry AI Conversations and return one summary row per conversation.",
    "",
    "Use this tool to find or list AI Conversations. Results are conversation summaries, not raw span rows.",
    "Use get_ai_conversation_details with a conversationId to fetch the transcript. Use get_sentry_resource for Sentry conversation URLs.",
    "",
    "<examples>",
    "search_ai_conversations(organizationSlug='my-org', query='failed conversations', statsPeriod='7d')",
    "search_ai_conversations(organizationSlug='my-org', query='checkout', project='backend', sort='-errors')",
    "</examples>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    query: z
      .string()
      .trim()
      .optional()
      .describe("Conversation query/filter string."),
    sort: z
      .enum(SORT_VALUES)
      .default("-timestamp")
      .describe("Conversation summary sort key."),
    samplingMode: z
      .enum(SAMPLING_MODES)
      .optional()
      .describe("Sentry AI Conversations sampling mode."),
    project: z
      .union([ParamProjectSlug, z.array(ParamProjectSlug).min(1)])
      .optional()
      .describe("Project slug or numeric project ID, or an array of projects."),
    environment: z
      .union([
        z.string().trim().min(1),
        z.array(z.string().trim().min(1)).min(1),
      ])
      .optional()
      .describe("Environment name, or an array of environments."),
    statsPeriod: z
      .string()
      .trim()
      .optional()
      .describe("Relative time range such as 24h, 7d, or 30d."),
    start: z
      .string()
      .trim()
      .optional()
      .describe("Explicit start time for the search window."),
    end: z
      .string()
      .trim()
      .optional()
      .describe("Explicit end time for the search window."),
    cursor: z
      .string()
      .trim()
      .optional()
      .describe("Pagination cursor from a previous response."),
    limit: z.number().int().min(1).max(100).default(10),
    regionUrl: ParamRegionUrl.optional(),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  outputSchema: searchAIConversationsOutputSchema,
  async handler(params, context: ServerContext) {
    if ((params.start && !params.end) || (!params.start && params.end)) {
      throw new UserInputError("`start` and `end` must be provided together.");
    }
    if (params.statsPeriod && (params.start || params.end)) {
      throw new UserInputError(
        "`statsPeriod` cannot be combined with `start` and `end`.",
      );
    }

    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);

    const projectIds = await resolveProjectIds({
      apiService,
      organizationSlug,
      project: params.project,
      constrainedProjectSlug: context.constraints.projectSlug,
    });

    const { conversations, nextCursor } =
      await apiService.searchAIConversations({
        organizationSlug,
        query: params.query,
        sort: params.sort,
        samplingMode: params.samplingMode,
        project: projectIds,
        environment: params.environment,
        statsPeriod: params.statsPeriod,
        start: params.start,
        end: params.end,
        limit: params.limit,
        cursor: params.cursor,
      });

    const artifact = buildArtifact(
      apiService,
      organizationSlug,
      conversations,
      nextCursor,
    );

    const output = [
      `# AI Conversations in **${organizationSlug}**`,
      "",
      formatExecutedSearch({
        query: params.query,
        sort: params.sort,
        projectIds,
        environment: params.environment,
        statsPeriod: params.statsPeriod,
        start: params.start,
        end: params.end,
        limit: params.limit,
        cursor: params.cursor,
        samplingMode: params.samplingMode,
      }),
      "",
    ];

    if (conversations.length === 0) {
      output.push("No AI conversations found.", "");
    } else {
      output.push(
        `Found ${conversations.length} AI conversation${conversations.length === 1 ? "" : "s"}.`,
        "",
        ...conversations.map((conversation) =>
          formatConversation(apiService, organizationSlug, conversation),
        ),
      );
    }

    output.push("## Next Steps", "");
    output.push(
      "- Fetch a transcript with `get_ai_conversation_details` using a `conversationId` above.",
      "- Fetch by URL with `get_sentry_resource` using a conversation URL above.",
      "- Query related spans with `search_events` using dataset `spans` and query `gen_ai.conversation.id:<conversationId>` to inspect telemetry across traces.",
      "- Use listed trace IDs only for per-trace follow-up; a conversation can span multiple traces.",
    );
    if (nextCursor) {
      output.push(
        `- More conversations are available. Pass \`cursor: "${nextCursor}"\` with the same search scope to fetch the next page.`,
      );
    }

    output.push(
      "",
      "## Structured Artifact",
      "",
      "```json",
      JSON.stringify(artifact, null, 2),
      "```",
    );

    return createStructuredTextResult({
      text: output.join("\n"),
      structuredContent: artifact,
    });
  },
});
