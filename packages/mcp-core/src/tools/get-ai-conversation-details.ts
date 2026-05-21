import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { ParamOrganizationSlug, ParamRegionUrl } from "../schema";
import type { AIConversationSpan, SentryApiService } from "../api-client";
import type { ServerContext } from "../types";

type ToolCall = {
  name: string;
  spanId: string;
  timestamp: number;
  status?: string;
  arguments?: string;
  input?: string;
};

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  spanId: string;
  agentName?: string;
  model?: string;
  userEmail?: string;
  toolCalls?: ToolCall[];
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
    status: span["span.status"],
    arguments: span["gen_ai.tool.call.arguments"],
    input: span["gen_ai.tool.input"],
  };
}

function extractMessages(spans: AIConversationSpan[]): ConversationMessage[] {
  const sorted = [...spans].sort(
    (a, b) => a["precise.start_ts"] - b["precise.start_ts"],
  );
  const aiClientSpans = sorted.filter(
    (span) => getOperationType(span) === "ai_client",
  );
  const toolSpans = sorted.filter((span) => getOperationType(span) === "tool");
  const messages: ConversationMessage[] = [];

  for (const [index, span] of aiClientSpans.entries()) {
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
    if (userContent) {
      messages.push({
        role: "user",
        content: userContent,
        timestamp: span["precise.start_ts"],
        spanId: span.span_id,
        userEmail: span["user.email"],
      });
    }

    const assistantContent = extractAssistantContent(span);
    if (assistantContent) {
      messages.push({
        role: "assistant",
        content: assistantContent,
        timestamp: span["precise.finish_ts"],
        spanId: span.span_id,
        agentName: span["gen_ai.agent.name"],
        model: span["gen_ai.response.model"] ?? span["gen_ai.request.model"],
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    }
  }

  return messages.sort((a, b) => a.timestamp - b.timestamp);
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

function buildConversationArtifact(
  apiService: SentryApiService,
  organizationSlug: string,
  conversationId: string,
  spans: AIConversationSpan[],
) {
  const messages = extractMessages(spans);
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
    messageCount: messages.length,
    toolCallCount: spans.filter((span) => getOperationType(span) === "tool")
      .length,
    totalTokens: spans.reduce(
      (sum, span) => sum + numeric(span["gen_ai.usage.total_tokens"]),
      0,
    ),
    messages,
    spans,
  };
}

export default defineTool({
  name: "get_ai_conversation_details",
  skills: ["inspect", "triage", "seer"],
  internalOnly: true,
  requiredScopes: ["event:read", "project:read"],

  description:
    "Fetch a structured AI conversation transcript and raw span artifact by conversation ID.",

  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    conversationId: z
      .string()
      .trim()
      .describe("The AI conversation ID from gen_ai.conversation.id."),
    regionUrl: ParamRegionUrl.optional(),
  },

  annotations: { readOnlyHint: true, openWorldHint: true },

  async handler(params, context: ServerContext) {
    setTag("organization.slug", params.organizationSlug);
    setTag("ai_conversation.id", params.conversationId);

    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });
    const constrainedProject = context.constraints.projectSlug
      ? await apiService.getProject({
          organizationSlug: params.organizationSlug,
          projectSlugOrId: context.constraints.projectSlug,
        })
      : null;
    const spans = await apiService.getAIConversation(
      {
        organizationSlug: params.organizationSlug,
        conversationId: params.conversationId,
        project: constrainedProject ? String(constrainedProject.id) : "-1",
      },
      undefined,
    );

    if (spans.length === 0) {
      return [
        `# AI Conversation \`${params.conversationId}\` in **${params.organizationSlug}**`,
        "",
        "No AI spans found for this conversation in the last 30 days.",
      ].join("\n");
    }

    const artifact = buildConversationArtifact(
      apiService,
      params.organizationSlug,
      params.conversationId,
      spans,
    );

    const output = [
      `# AI Conversation \`${params.conversationId}\` in **${params.organizationSlug}**`,
      "",
      "## Summary",
      "",
      `**Started**: ${formatTimestamp(artifact.startTimestamp)}`,
      `**Ended**: ${formatTimestamp(artifact.endTimestamp)}`,
      `**Projects**: ${artifact.projects.join(", ") || "None"}`,
      `**Trace IDs**: ${artifact.traceIds.join(", ") || "None"}`,
      `**Messages**: ${artifact.messageCount}`,
      `**Tool Calls**: ${artifact.toolCallCount}`,
      `**Spans**: ${artifact.spanCount}`,
      `**Total Tokens**: ${artifact.totalTokens}`,
      "",
      "## View in Sentry",
      "",
      artifact.url,
      "",
      "## Transcript",
      "",
      ...artifact.messages.flatMap((message) => [
        `### ${message.role === "user" ? "User" : "Assistant"} - ${formatTimestamp(message.timestamp)}`,
        "",
        truncate(message.content),
        "",
        ...(message.toolCalls?.length
          ? [
              "**Tool calls for this turn**:",
              "",
              ...message.toolCalls.map(
                (toolCall) =>
                  `- ${toolCall.name} (${toolCall.spanId})${toolCall.status ? ` - ${toolCall.status}` : ""}`,
              ),
              "",
            ]
          : []),
      ]),
      "## Structured Artifact",
      "",
      "```json",
      JSON.stringify(artifact, null, 2),
      "```",
    ];

    return output.join("\n");
  },
});
