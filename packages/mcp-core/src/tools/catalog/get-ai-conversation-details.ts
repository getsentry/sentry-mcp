import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { structuredResult } from "../../internal/tool-helpers/results";
import { ParamOrganizationSlug, ParamRegionUrl } from "../../schema";
import { UserInputError } from "../../errors";
import type { AIConversationSpan, SentryApiService } from "../../api-client";
import type { ServerContext } from "../../types";

type ToolCall = {
  type: "tool_call";
  name: string;
  spanId: string;
  traceId: string;
  timestamp: number;
  durationMs: number;
  status?: string;
  arguments?: string;
  input?: string;
};

type ConversationMessage = {
  type: "message";
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  spanId: string;
  traceId: string;
  metadata?: {
    agentName?: string;
    model?: string;
    totalTokens: number;
    status?: string;
    durationMs: number;
  };
};

type TimelineEvent = ConversationMessage | ToolCall;
type LookupWindow = {
  statsPeriod?: string;
  start?: string;
  end?: string;
};

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

const toolCallSchema = z.object({
  type: z.literal("tool_call"),
  name: z.string(),
  spanId: z.string(),
  traceId: z.string(),
  timestamp: z.number(),
  durationMs: z.number(),
  status: z.string().optional(),
  arguments: z.string().optional(),
  input: z.string().optional(),
});

const conversationMessageSchema = z.object({
  type: z.literal("message"),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.number(),
  spanId: z.string(),
  traceId: z.string(),
  metadata: z
    .object({
      agentName: z.string().optional(),
      model: z.string().optional(),
      totalTokens: z.number(),
      status: z.string().optional(),
      durationMs: z.number(),
    })
    .optional(),
});

const timelineEventSchema = z.discriminatedUnion("type", [
  conversationMessageSchema,
  toolCallSchema,
]);

const lookupWindowSchema = z.object({
  statsPeriod: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
});

export const aiConversationDetailsOutputSchema = z.object({
  conversationId: z.string(),
  organizationSlug: z.string(),
  url: z.string().url(),
  lookupWindow: lookupWindowSchema,
  startTimestamp: z.number().nullable(),
  endTimestamp: z.number().nullable(),
  traceIds: z.array(z.string()),
  projects: z.array(z.string()),
  spanCount: z.number(),
  aiCallCount: z.number(),
  messageCount: z.number(),
  toolCallCount: z.number(),
  totalTokens: z.number(),
  timeline: z.array(timelineEventSchema),
});

type AIConversationDetailsOutput = z.infer<
  typeof aiConversationDetailsOutputSchema
>;

function numeric(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function timestampMs(value: number): number {
  return Math.round(value * 1000);
}

function getOperationType(span: AIConversationSpan): string | undefined {
  const explicit = span["gen_ai.operation.type"];
  if (explicit) {
    return explicit;
  }

  const spanName = span["span.name"];
  if (!spanName?.startsWith("gen_ai.")) {
    return undefined;
  }
  if (spanName === "gen_ai.execute_tool") {
    return "tool";
  }
  if (
    spanName === "gen_ai.invoke_agent" ||
    spanName === "gen_ai.create_agent"
  ) {
    return "agent";
  }
  if (spanName === "gen_ai.handoff") {
    return "handoff";
  }
  return "ai_client";
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringifyContent(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object") {
          const record = part as Record<string, unknown>;
          if (typeof record.text === "string") {
            return record.text;
          }
          if (typeof record.content === "string") {
            return record.content;
          }
        }
        return null;
      })
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join("\n") : null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
    if (typeof record.content === "string") {
      return record.content;
    }
    if (typeof record.message === "string") {
      return record.message;
    }
  }
  return value == null ? null : JSON.stringify(value);
}

function collectMessages(value: unknown): { role?: string; content: string }[] {
  const source =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as Record<string, unknown>).messages)
      ? (value as Record<string, unknown>).messages
      : value;

  if (!Array.isArray(source)) {
    const content = stringifyContent(source);
    return content ? [{ content }] : [];
  }

  return source
    .map((message) => {
      if (typeof message === "string") {
        return { content: message };
      }
      if (!message || typeof message !== "object") {
        return null;
      }
      const record = message as Record<string, unknown>;
      const content = stringifyContent(record.content ?? record.text ?? record);
      if (!content) {
        return null;
      }
      return {
        role: typeof record.role === "string" ? record.role : undefined,
        content,
      };
    })
    .filter((message): message is { role?: string; content: string } =>
      Boolean(message),
    );
}

function extractUserContent(span: AIConversationSpan): string | null {
  const raw =
    span["gen_ai.input.messages"] ?? span["gen_ai.request.messages"] ?? null;
  if (!raw) {
    return null;
  }
  if (raw === "[Filtered]") {
    return raw;
  }
  const messages = collectMessages(parseJson(raw));
  const userMessage = messages.findLast((message) => message.role === "user");
  return userMessage?.content ?? messages.at(-1)?.content ?? null;
}

function extractAssistantContent(span: AIConversationSpan): string | null {
  const outputMessages = span["gen_ai.output.messages"];
  if (outputMessages) {
    if (outputMessages === "[Filtered]") {
      return outputMessages;
    }
    const messages = collectMessages(parseJson(outputMessages));
    const assistantMessage = messages.findLast(
      (message) => message.role === "assistant",
    );
    const content = assistantMessage?.content ?? messages.at(-1)?.content;
    if (content) {
      return content;
    }
  }

  return span["gen_ai.response.text"] ?? span["gen_ai.response.object"] ?? null;
}

function buildToolCall(span: AIConversationSpan): ToolCall | null {
  const name = span["gen_ai.tool.name"];
  if (!name) {
    return null;
  }

  return withoutUndefined({
    type: "tool_call" as const,
    name,
    spanId: span.span_id,
    traceId: span.trace,
    timestamp: timestampMs(span["precise.start_ts"]),
    durationMs: Math.round(
      (span["precise.finish_ts"] - span["precise.start_ts"]) * 1000,
    ),
    status: span["span.status"],
    arguments: span["gen_ai.tool.call.arguments"],
    input: span["gen_ai.tool.input"],
  });
}

function buildMessageEvents(span: AIConversationSpan): ConversationMessage[] {
  const durationMs = Math.round(
    (span["precise.finish_ts"] - span["precise.start_ts"]) * 1000,
  );
  const metadata = withoutUndefined({
    agentName: span["gen_ai.agent.name"],
    model: span["gen_ai.response.model"] ?? span["gen_ai.request.model"],
    totalTokens: numeric(span["gen_ai.usage.total_tokens"]),
    status: span["span.status"],
    durationMs,
  });
  const events: ConversationMessage[] = [];
  const userContent = extractUserContent(span);
  if (userContent) {
    events.push(
      withoutUndefined({
        type: "message" as const,
        role: "user" as const,
        content: userContent,
        timestamp: timestampMs(span["precise.start_ts"]),
        spanId: span.span_id,
        traceId: span.trace,
        metadata: undefined,
      }),
    );
  }

  const assistantContent = extractAssistantContent(span);
  if (assistantContent) {
    events.push({
      type: "message",
      role: "assistant",
      content: assistantContent,
      timestamp: timestampMs(span["precise.finish_ts"]),
      spanId: span.span_id,
      traceId: span.trace,
      metadata,
    });
  } else if (events.length > 0) {
    events[events.length - 1] = {
      ...events[events.length - 1]!,
      metadata,
    };
  }

  return events;
}

function extractTimeline(spans: AIConversationSpan[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const span of spans) {
    const operationType = getOperationType(span);
    if (operationType === "tool") {
      const toolCall = buildToolCall(span);
      if (toolCall) {
        events.push(toolCall);
      }
      continue;
    }
    if (operationType === "ai_client") {
      events.push(...buildMessageEvents(span));
    }
  }

  return events.sort((a, b) => {
    const timestampDiff = a.timestamp - b.timestamp;
    if (timestampDiff !== 0) {
      return timestampDiff;
    }
    if (a.type !== b.type) {
      return a.type === "message" ? -1 : 1;
    }
    return a.spanId.localeCompare(b.spanId);
  });
}

function countAICalls(spans: AIConversationSpan[]): number {
  return spans.filter((span) => getOperationType(span) === "ai_client").length;
}

function buildConversationArtifact(
  apiService: SentryApiService,
  organizationSlug: string,
  conversationId: string,
  spans: AIConversationSpan[],
  lookupWindow: LookupWindow,
): AIConversationDetailsOutput {
  const timeline = extractTimeline(spans);
  const traceIds = [...new Set(spans.map((span) => span.trace))].sort();
  const projects = [...new Set(spans.map((span) => span.project))].sort();
  const startTimestamp =
    spans.length > 0
      ? Math.min(...spans.map((span) => span["precise.start_ts"]))
      : null;
  const endTimestamp =
    spans.length > 0
      ? Math.max(...spans.map((span) => span["precise.finish_ts"]))
      : null;

  return withoutUndefined({
    conversationId,
    organizationSlug,
    url: apiService.getAIConversationUrl(organizationSlug, conversationId),
    lookupWindow,
    startTimestamp:
      startTimestamp === null ? null : timestampMs(startTimestamp),
    endTimestamp: endTimestamp === null ? null : timestampMs(endTimestamp),
    traceIds,
    projects,
    spanCount: spans.length,
    aiCallCount: countAICalls(spans),
    messageCount: timeline.filter((event) => event.type === "message").length,
    toolCallCount: timeline.filter((event) => event.type === "tool_call")
      .length,
    totalTokens: spans.reduce(
      (sum, span) => sum + numeric(span["gen_ai.usage.total_tokens"]),
      0,
    ),
    timeline,
  });
}

export default defineTool({
  name: "get_ai_conversation_details",
  skills: ["inspect", "triage", "seer"],
  requiredScopes: ["event:read", "project:read"],

  description: [
    "Fetch the chronological transcript and debugging details for one AI conversation.",
    "",
    "Returns a timeline of user messages, assistant messages, and tool calls, with trace/span IDs for deeper debugging. To discover or list conversations, use search_ai_conversations.",
  ].join("\n"),

  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    conversationId: z
      .string()
      .trim()
      .describe("The AI conversation ID from gen_ai.conversation.id."),
    project: z
      .string()
      .trim()
      .optional()
      .describe(
        "Numeric project ID to scope the query. Falls back to context constraint or all projects.",
      ),
    start: z
      .string()
      .trim()
      .optional()
      .describe("Explicit start time for the conversation lookup window."),
    end: z
      .string()
      .trim()
      .optional()
      .describe("Explicit end time for the conversation lookup window."),
    regionUrl: ParamRegionUrl.optional(),
  },

  annotations: { readOnlyHint: true, openWorldHint: true },
  outputSchema: aiConversationDetailsOutputSchema,

  async handler(params, context: ServerContext) {
    setTag("organization.slug", params.organizationSlug);
    setTag("ai_conversation.id", params.conversationId);

    if ((params.start && !params.end) || (!params.start && params.end)) {
      throw new UserInputError("`start` and `end` must be provided together.");
    }

    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });

    let projectId: string | undefined;
    if (context.constraints.projectSlug) {
      const constrainedProject = await apiService.getProject({
        organizationSlug: params.organizationSlug,
        projectSlugOrId: context.constraints.projectSlug,
      });
      projectId = String(constrainedProject.id);
    } else if (params.project) {
      projectId = params.project;
    }

    const spans = await apiService.getAIConversation(
      {
        organizationSlug: params.organizationSlug,
        conversationId: params.conversationId,
        project: projectId ?? "-1",
        start: params.start,
        end: params.end,
      },
      undefined,
    );

    const artifact = buildConversationArtifact(
      apiService,
      params.organizationSlug,
      params.conversationId,
      spans,
      params.start && params.end
        ? { start: params.start, end: params.end }
        : { statsPeriod: "30d" },
    );
    return structuredResult(artifact);
  },
});
