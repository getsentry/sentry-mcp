import { describe, expect, it } from "vitest";
import {
  formatAIConversationActionInstructions,
  getAIConversationSuggestedActions,
} from "./ai-conversation-actions";

const actionParams = {
  organizationSlug: "test-org",
  aiConversations: [{ conversationId: "conversation-123" }],
  experimentalMode: false,
};

describe("AI conversation suggested actions", () => {
  it("uses the public catalog gateway consistently in markdown and structured content", () => {
    const availableToolNames = new Set([
      "get_ai_conversation_details",
      "execute_sentry_tool",
    ]);
    const directToolNames = new Set(["execute_sentry_tool"]);

    expect(
      getAIConversationSuggestedActions({
        ...actionParams,
        availableToolNames,
        directToolNames,
      }),
    ).toEqual([
      {
        type: "tool_call",
        toolName: "execute_sentry_tool",
        arguments: {
          name: "get_ai_conversation_details",
          arguments: {
            organizationSlug: "test-org",
            conversationId: "conversation-123",
          },
        },
        reason: "Fetch the full transcript for this AI conversation.",
      },
    ]);
    expect(
      formatAIConversationActionInstructions({
        ...actionParams,
        availableToolNames,
        directToolNames,
      }),
    ).toEqual([
      'Use the Sentry tool `execute_sentry_tool(name=\'get_ai_conversation_details\', arguments={"organizationSlug":"test-org","conversationId":"conversation-123"})` to fetch the full transcript.',
    ]);
  });

  it("omits the action when no direct execution route is available", () => {
    const availableToolNames = new Set([
      "get_ai_conversation_details",
      "execute_sentry_tool",
    ]);
    const directToolNames = new Set<string>();

    expect(
      getAIConversationSuggestedActions({
        ...actionParams,
        availableToolNames,
        directToolNames,
      }),
    ).toEqual([]);
    expect(
      formatAIConversationActionInstructions({
        ...actionParams,
        availableToolNames,
        directToolNames,
      }),
    ).toEqual([
      "AI conversation detail lookup is not available in this session.",
    ]);
  });

  it("uses the conversation tool directly when it is exposed through tools/list", () => {
    const availableToolNames = new Set(["get_ai_conversation_details"]);
    const directToolNames = new Set(["get_ai_conversation_details"]);

    expect(
      getAIConversationSuggestedActions({
        ...actionParams,
        availableToolNames,
        directToolNames,
      }),
    ).toMatchObject([
      {
        toolName: "get_ai_conversation_details",
        arguments: {
          organizationSlug: "test-org",
          conversationId: "conversation-123",
        },
      },
    ]);
    expect(
      formatAIConversationActionInstructions({
        ...actionParams,
        availableToolNames,
        directToolNames,
      }),
    ).toEqual([
      "Use the Sentry tool `get_ai_conversation_details(organizationSlug='test-org', conversationId='conversation-123')` to fetch the full transcript.",
    ]);
  });
});
