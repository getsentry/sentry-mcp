import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isToolAvailableInSession } from "./tool-call-formatting";
import { isTopLevelToolName } from "../../tools/surfaces";

const MAX_SUGGESTED_ACTIONS = 3;

export interface AIConversationReference {
  conversationId: string;
  spanId?: string;
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
  if (
    aiConversations.length === 0 ||
    !isToolAvailableInSession("get_ai_conversation_details", availableToolNames)
  ) {
    return markdown;
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
    return markdown;
  }

  return {
    content: [{ type: "text", text: markdown }],
    structuredContent: {
      suggestedActions: aiConversations
        .slice(0, MAX_SUGGESTED_ACTIONS)
        .map((conversation) => {
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
        }),
    },
  };
}
