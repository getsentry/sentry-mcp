import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { ParamOrganizationSlug, ParamRegionUrl } from "../../schema";
import { UserInputError } from "../../errors";
import type { AIConversationSpan, SentryApiService } from "../../api-client";
import type { ServerContext } from "../../types";

type ToolCall = {
  name: string;
  spanId: string;
  timestamp: number;
  durationMs: number;
  status?: string;
  arguments?: string;
  input?: string;
};

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  spanId: string;
  userEmail?: string;
};

type ConversationTurn = {
  turn: number;
  spanId: string;
  traceId: string;
  project: string;
  started: number;
  ended: number;
  durationMs: number;
  user?: ConversationMessage;
  assistant?: ConversationMessage;
  toolCalls: ToolCall[];
  metadata: {
    agentName?: string;
    model?: string;
    totalTokens: number;
    status?: string;
  };
};

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

  return {
    name,
    spanId: span.span_id,
    timestamp: span["precise.start_ts"],
    durationMs: Math.round(
      (span["precise.finish_ts"] - span["precise.start_ts"]) * 1000,
    ),
    status: span["span.status"],
    arguments: span["gen_ai.tool.call.arguments"],
    input: span["gen_ai.tool.input"],
  };
}

function extractTurns(spans: AIConversationSpan[]): ConversationTurn[] {
  const sorted = [...spans].sort(
    (a, b) => a["precise.start_ts"] - b["precise.start_ts"],
  );
  const aiClientSpans = sorted.filter(
    (span) => getOperationType(span) === "ai_client",
  );
  const toolSpans = sorted.filter((span) => getOperationType(span) === "tool");

  return aiClientSpans.map((span, index) => {
    const nextTimestamp =
      index < aiClientSpans.length - 1
        ? aiClientSpans[index + 1]!["precise.start_ts"]
        : Number.POSITIVE_INFINITY;
    const toolCalls = toolSpans
      .filter((toolSpan) => {
        const timestamp = toolSpan["precise.start_ts"];
        return (
          timestamp >= span["precise.start_ts"] && timestamp < nextTimestamp
        );
      })
      .map(buildToolCall)
      .filter((toolCall): toolCall is ToolCall => toolCall !== null);

    const userContent = extractUserContent(span);
    const assistantContent = extractAssistantContent(span);

    return {
      turn: index + 1,
      spanId: span.span_id,
      traceId: span.trace,
      project: span.project,
      started: span["precise.start_ts"],
      ended: span["precise.finish_ts"],
      durationMs: Math.round(
        (span["precise.finish_ts"] - span["precise.start_ts"]) * 1000,
      ),
      user: userContent
        ? {
            role: "user",
            content: userContent,
            timestamp: span["precise.start_ts"],
            spanId: span.span_id,
            userEmail: span["user.email"],
          }
        : undefined,
      assistant: assistantContent
        ? {
            role: "assistant",
            content: assistantContent,
            timestamp: span["precise.finish_ts"],
            spanId: span.span_id,
          }
        : undefined,
      toolCalls,
      metadata: {
        agentName: span["gen_ai.agent.name"],
        model: span["gen_ai.response.model"] ?? span["gen_ai.request.model"],
        totalTokens: numeric(span["gen_ai.usage.total_tokens"]),
        status: span["span.status"],
      },
    };
  });
}

function flattenMessages(turns: ConversationTurn[]): ConversationMessage[] {
  const messages: ConversationMessage[] = [];

  for (const turn of turns) {
    if (turn.user) {
      messages.push(turn.user);
    }
    if (turn.assistant) {
      messages.push(turn.assistant);
    }
  }

  return messages;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

function truncate(value: string, maxLength = 600): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
}

function formatMaybeJson(value: string): string {
  const parsed = parseJson(value);
  const formatted =
    typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
  return truncate(formatted, 1200);
}

function formatIndentedCodeBlock(value: string): string[] {
  return [
    "  ```json",
    ...formatMaybeJson(value)
      .split("\n")
      .map((line) => `  ${line}`),
    "  ```",
  ];
}

function formatTurn(turn: ConversationTurn): string[] {
  const metadata = [
    turn.metadata.model,
    turn.metadata.agentName,
    turn.metadata.totalTokens > 0
      ? `${turn.metadata.totalTokens} tokens`
      : null,
    formatDuration(turn.durationMs),
    turn.metadata.status,
  ].filter((item): item is string => Boolean(item));

  const output = [
    `### Turn ${turn.turn} - ${formatTimestamp(turn.started)}`,
    "",
    metadata.length > 0 ? `_${metadata.join(" | ")}_` : null,
    metadata.length > 0 ? "" : null,
    turn.user ? "**User**" : null,
    turn.user ? "" : null,
    turn.user ? truncate(turn.user.content) : null,
    turn.user ? "" : null,
    turn.assistant ? "**Assistant**" : null,
    turn.assistant ? "" : null,
    turn.assistant ? truncate(turn.assistant.content) : null,
    turn.assistant ? "" : null,
  ].filter((line): line is string => line !== null);

  if (turn.toolCalls.length > 0) {
    output.push("**Tools**", "");

    for (const toolCall of turn.toolCalls) {
      output.push(
        `- ${toolCall.name} (${toolCall.spanId})${toolCall.status ? ` - ${toolCall.status}` : ""} - ${formatDuration(toolCall.durationMs)}`,
      );

      if (toolCall.arguments) {
        output.push(
          "",
          "  Arguments:",
          "",
          ...formatIndentedCodeBlock(toolCall.arguments),
        );
      }

      if (toolCall.input && toolCall.input !== toolCall.arguments) {
        output.push(
          "",
          "  Input:",
          "",
          ...formatIndentedCodeBlock(toolCall.input),
        );
      }
    }

    output.push("");
  }

  return output;
}

function buildConversationArtifact(
  apiService: SentryApiService,
  organizationSlug: string,
  conversationId: string,
  spans: AIConversationSpan[],
) {
  const turns = extractTurns(spans);
  const messages = flattenMessages(turns);
  const traceIds = [...new Set(spans.map((span) => span.trace))].sort();
  const projects = [...new Set(spans.map((span) => span.project))].sort();
  const startTimestamp = Math.min(
    ...spans.map((span) => span["precise.start_ts"]),
  );
  const endTimestamp = Math.max(
    ...spans.map((span) => span["precise.finish_ts"]),
  );

  return {
    conversationId,
    organizationSlug,
    url: apiService.getAIConversationUrl(organizationSlug, conversationId),
    startTimestamp,
    endTimestamp,
    traceIds,
    projects,
    spanCount: spans.length,
    turnCount: turns.length,
    messageCount: messages.length,
    toolCallCount: turns.reduce((sum, turn) => sum + turn.toolCalls.length, 0),
    totalTokens: spans.reduce(
      (sum, span) => sum + numeric(span["gen_ai.usage.total_tokens"]),
      0,
    ),
    turns,
    messages,
    spanIds: spans.map((span) => span.span_id),
  };
}

function formatLookupWindow(params: { start?: string; end?: string }): string {
  if (params.start && params.end) {
    return `between ${params.start} and ${params.end}`;
  }
  return "in the last 30 days";
}

export default defineTool({
  name: "get_ai_conversation_details",
  skills: ["inspect", "triage", "seer"],
  requiredScopes: ["event:read", "project:read"],

  description: [
    "Fetch all spans for an AI conversation by its gen_ai.conversation.id.",
    "",
    "A conversation is a set of spans sharing the same gen_ai.conversation.id. To discover or list conversations, use search_ai_conversations.",
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
    spanId: z
      .string()
      .trim()
      .optional()
      .describe("Optional focused span ID from a Sentry conversation URL."),
    regionUrl: ParamRegionUrl.optional(),
  },

  annotations: { readOnlyHint: true, openWorldHint: true },

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

    if (spans.length === 0) {
      return [
        `# AI Conversation \`${params.conversationId}\` in **${params.organizationSlug}**`,
        "",
        `No AI spans found for this conversation ${formatLookupWindow(params)}.`,
      ].join("\n");
    }

    const artifact = buildConversationArtifact(
      apiService,
      params.organizationSlug,
      params.conversationId,
      spans,
    );
    const focusedSpanPresent = params.spanId
      ? artifact.spanIds.includes(params.spanId)
      : undefined;

    const output = [
      `# AI Conversation \`${params.conversationId}\` in **${params.organizationSlug}**`,
      "",
      "## Summary",
      "",
      `**Started**: ${formatTimestamp(artifact.startTimestamp)}`,
      `**Ended**: ${formatTimestamp(artifact.endTimestamp)}`,
      `**Projects**: ${artifact.projects.join(", ") || "None"}`,
      `**Trace IDs**: ${artifact.traceIds.join(", ") || "None"}`,
      `**Turns**: ${artifact.turnCount}`,
      `**Messages**: ${artifact.messageCount}`,
      `**Tool Calls**: ${artifact.toolCallCount}`,
      `**Spans**: ${artifact.spanCount}`,
      `**Total Tokens**: ${artifact.totalTokens}`,
      params.spanId ? `**Focused Span**: ${params.spanId}` : null,
      params.spanId
        ? `**Focused Span Present**: ${focusedSpanPresent ? "yes" : "no"}`
        : null,
      "",
      "## View in Sentry",
      "",
      artifact.url,
      "",
      "## Related Telemetry",
      "",
      `- Query spans with \`search_events\` using dataset \`spans\` and query \`gen_ai.conversation.id:${params.conversationId}\` to inspect telemetry across traces.`,
      artifact.traceIds.length > 0
        ? `- This conversation spans ${artifact.traceIds.length} trace${artifact.traceIds.length === 1 ? "" : "s"}: ${artifact.traceIds.map((traceId) => `\`${traceId}\``).join(", ")}. Inspect trace IDs individually only when you need trace-local context.`
        : "- No trace IDs were found on the conversation spans.",
      "",
      "## Transcript",
      "",
      ...artifact.turns.flatMap(formatTurn),
      "## Structured Artifact",
      "",
      "```json",
      JSON.stringify(
        {
          ...artifact,
          focusedSpanId: params.spanId,
          focusedSpanPresent,
        },
        null,
        2,
      ),
      "```",
    ].filter((line): line is string => line !== null);

    return output.join("\n");
  },
});
