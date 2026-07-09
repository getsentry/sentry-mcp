import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  formatToolCall,
  isToolAvailableInSession,
} from "./tool-call-formatting";
import { isTopLevelToolName } from "../../tools/surfaces";

const MAX_SUGGESTED_ACTIONS = 3;

export interface AIConversationReference {
  conversationId: string;
  spanId?: string;
}

type SuggestedActionValue =
  | string
  | number
  | boolean
  | null
  | SuggestedActionValue[]
  | { [key: string]: SuggestedActionValue };

/** A concrete, session-callable MCP follow-up action. */
interface SuggestedToolAction {
  type: "tool_call";
  toolName: string;
  arguments: Record<string, SuggestedActionValue>;
  reason: string;
}

function formatInlineCode(value: string): string {
  const backtickRuns = value.match(/`+/g) ?? [];
  const fenceLength =
    backtickRuns.reduce((max, run) => Math.max(max, run.length), 0) + 1;
  const fence = "`".repeat(fenceLength);
  const needsPadding = value.startsWith("`") || value.endsWith("`");
  return needsPadding
    ? `${fence} ${value} ${fence}`
    : `${fence}${value}${fence}`;
}

/** Builds transcript actions that match the session's direct or catalog surface. */
export function getAIConversationSuggestedActions({
  organizationSlug,
  aiConversations,
  experimentalMode,
  availableToolNames,
  directToolNames,
}: {
  organizationSlug: string;
  aiConversations: AIConversationReference[];
  experimentalMode: boolean;
  availableToolNames?: ReadonlySet<string>;
  directToolNames?: ReadonlySet<string>;
}): SuggestedToolAction[] {
  if (
    aiConversations.length === 0 ||
    !isToolAvailableInSession("get_ai_conversation_details", availableToolNames)
  ) {
    return [];
  }

  const targetIsDirect = directToolNames
    ? directToolNames.has("get_ai_conversation_details")
    : isTopLevelToolName("get_ai_conversation_details", experimentalMode);
  const executeToolIsDirect = directToolNames
    ? directToolNames.has("execute_sentry_tool")
    : isTopLevelToolName("execute_sentry_tool", experimentalMode);
  const useCatalogGateway =
    !targetIsDirect &&
    executeToolIsDirect &&
    isToolAvailableInSession("execute_sentry_tool", availableToolNames);

  if (!targetIsDirect && !useCatalogGateway) {
    return [];
  }

  return aiConversations.slice(0, MAX_SUGGESTED_ACTIONS).map((conversation) => {
    const targetArguments = {
      organizationSlug,
      conversationId: conversation.conversationId,
    };

    return targetIsDirect
      ? {
          type: "tool_call",
          toolName: "get_ai_conversation_details",
          arguments: targetArguments,
          reason: "Fetch the full transcript for this AI conversation.",
        }
      : {
          type: "tool_call",
          toolName: "execute_sentry_tool",
          arguments: {
            name: "get_ai_conversation_details",
            arguments: targetArguments,
          },
          reason: "Fetch the full transcript for this AI conversation.",
        };
  });
}

/** Returns markdown instructions that mirror the callable structured actions. */
export function formatAIConversationActionInstructions({
  organizationSlug,
  aiConversations,
  experimentalMode,
  availableToolNames,
  directToolNames,
}: {
  organizationSlug: string;
  aiConversations: AIConversationReference[];
  experimentalMode: boolean;
  availableToolNames?: ReadonlySet<string>;
  directToolNames?: ReadonlySet<string>;
}): string[] {
  const actions = getAIConversationSuggestedActions({
    organizationSlug,
    aiConversations,
    experimentalMode,
    availableToolNames,
    directToolNames,
  });

  if (actions.length === 0) {
    return ["AI conversation detail lookup is not available in this session."];
  }

  return actions.map(
    (action) =>
      `Use the Sentry tool ${formatInlineCode(
        formatToolCall({
          toolName: action.toolName,
          arguments: action.arguments,
        }),
      )} to fetch the full transcript.`,
  );
}

/**
 * Adds concrete transcript follow-ups to otherwise markdown-first results.
 * The markdown remains the compatibility path for clients that do not read
 * structured content.
 */
export function addAIConversationSuggestedActions({
  markdown,
  organizationSlug,
  aiConversations,
  experimentalMode,
  availableToolNames,
  directToolNames,
}: {
  markdown: string;
  organizationSlug: string;
  aiConversations: AIConversationReference[];
  experimentalMode: boolean;
  availableToolNames?: ReadonlySet<string>;
  directToolNames?: ReadonlySet<string>;
}): string | CallToolResult {
  const suggestedActions = getAIConversationSuggestedActions({
    organizationSlug,
    aiConversations,
    experimentalMode,
    availableToolNames,
    directToolNames,
  });
  if (suggestedActions.length === 0) {
    return markdown;
  }

  return {
    content: [{ type: "text", text: markdown }],
    structuredContent: {
      suggestedActions,
    },
  };
}
