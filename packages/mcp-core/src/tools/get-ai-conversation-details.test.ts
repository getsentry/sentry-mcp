import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import getAIConversationDetails from "./get-ai-conversation-details";
import getSentryResource from "./get-sentry-resource";

const baseContext = {
  constraints: {
    organizationSlug: undefined,
  },
  accessToken: "access-token",
  userId: "1",
};

const conversationSpans = [
  {
    "gen_ai.conversation.id": "conv-123",
    parent_span: null,
    "precise.finish_ts": 1713805401.5,
    "precise.start_ts": 1713805400,
    project: "mcp-server",
    "project.id": 4509109107622913,
    "span.name": "gen_ai.chat",
    "span.status": "ok",
    span_id: "1111111111111111",
    trace: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "gen_ai.operation.type": "ai_client",
    "gen_ai.input.messages": JSON.stringify([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "What failed in production?" },
    ]),
    "gen_ai.output.messages": JSON.stringify([
      { role: "assistant", content: "The checkout worker is timing out." },
    ]),
    "gen_ai.request.model": "gpt-5-mini",
    "gen_ai.response.model": "gpt-5-mini-2026-05-01",
    "gen_ai.usage.total_tokens": 42,
    "gen_ai.agent.name": "triage-agent",
    "user.email": "dev@example.com",
  },
  {
    "gen_ai.conversation.id": "conv-123",
    parent_span: "1111111111111111",
    "precise.finish_ts": 1713805402,
    "precise.start_ts": 1713805401.7,
    project: "mcp-server",
    "project.id": 4509109107622913,
    "span.name": "gen_ai.execute_tool",
    "span.status": "ok",
    span_id: "2222222222222222",
    trace: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "gen_ai.operation.type": "tool",
    "gen_ai.tool.name": "search_events",
    "gen_ai.tool.call.arguments": JSON.stringify({
      query: "level:error",
    }),
    "gen_ai.tool.input": JSON.stringify({ organizationSlug: "test-org" }),
  },
  {
    "gen_ai.conversation.id": "conv-123",
    parent_span: null,
    "precise.finish_ts": 1713805405,
    "precise.start_ts": 1713805404,
    project: "mcp-server",
    "project.id": 4509109107622913,
    "span.name": "gen_ai.chat",
    "span.status": "ok",
    span_id: "3333333333333333",
    trace: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "gen_ai.operation.type": "ai_client",
    "gen_ai.input.messages": JSON.stringify([
      { role: "user", content: "Can you inspect the failing event?" },
    ]),
    "gen_ai.response.text": "I found the timeout stack trace.",
    "gen_ai.usage.total_tokens": 58,
  },
];

function mockConversationEndpoint(
  org = "test-org",
  conversationId = "conv-123",
  spans = conversationSpans,
) {
  mswServer.use(
    http.get(
      `https://sentry.io/api/0/organizations/${org}/ai-conversations/${conversationId}/`,
      ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("statsPeriod")).toBe("30d");
        expect(url.searchParams.get("per_page")).toBe("1000");
        expect(url.searchParams.get("project")).toBe("-1");
        return HttpResponse.json(spans);
      },
    ),
  );
}

describe("get_ai_conversation_details", () => {
  it("returns a transcript and structured artifact", async () => {
    mockConversationEndpoint();

    const result = await getAIConversationDetails.handler(
      {
        organizationSlug: "test-org",
        conversationId: "conv-123",
      },
      baseContext,
    );

    expect(result).toMatchInlineSnapshot(`
      "# AI Conversation \`conv-123\` in **test-org**

      ## Summary

      **Started**: 2024-04-22T17:03:20.000Z
      **Ended**: 2024-04-22T17:03:25.000Z
      **Projects**: mcp-server
      **Trace IDs**: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      **Messages**: 4
      **Tool Calls**: 1
      **Spans**: 3
      **Total Tokens**: 100

      ## View in Sentry

      https://test-org.sentry.io/explore/conversations/conv-123/

      ## Transcript

      ### User - 2024-04-22T17:03:20.000Z

      What failed in production?

      ### Assistant - 2024-04-22T17:03:21.500Z

      The checkout worker is timing out.

      ### User - 2024-04-22T17:03:24.000Z

      Can you inspect the failing event?

      ### Assistant - 2024-04-22T17:03:25.000Z

      I found the timeout stack trace.

      **Tool calls before this response**:

      - search_events (2222222222222222) - ok

      ## Structured Artifact

      \`\`\`json
      {
        "conversationId": "conv-123",
        "organizationSlug": "test-org",
        "url": "https://test-org.sentry.io/explore/conversations/conv-123/",
        "startTimestamp": 1713805400,
        "endTimestamp": 1713805405,
        "traceIds": [
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        ],
        "projects": [
          "mcp-server"
        ],
        "spanCount": 3,
        "messageCount": 4,
        "toolCallCount": 1,
        "totalTokens": 100,
        "messages": [
          {
            "role": "user",
            "content": "What failed in production?",
            "timestamp": 1713805400,
            "spanId": "1111111111111111",
            "userEmail": "dev@example.com"
          },
          {
            "role": "assistant",
            "content": "The checkout worker is timing out.",
            "timestamp": 1713805401.5,
            "spanId": "1111111111111111",
            "agentName": "triage-agent",
            "model": "gpt-5-mini-2026-05-01"
          },
          {
            "role": "user",
            "content": "Can you inspect the failing event?",
            "timestamp": 1713805404,
            "spanId": "3333333333333333"
          },
          {
            "role": "assistant",
            "content": "I found the timeout stack trace.",
            "timestamp": 1713805405,
            "spanId": "3333333333333333",
            "toolCalls": [
              {
                "name": "search_events",
                "spanId": "2222222222222222",
                "timestamp": 1713805401.7,
                "status": "ok",
                "arguments": "{\\"query\\":\\"level:error\\"}",
                "input": "{\\"organizationSlug\\":\\"test-org\\"}"
              }
            ]
          }
        ],
        "spans": [
          {
            "gen_ai.conversation.id": "conv-123",
            "span_id": "1111111111111111",
            "trace": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "parent_span": null,
            "precise.start_ts": 1713805400,
            "precise.finish_ts": 1713805401.5,
            "project": "mcp-server",
            "project.id": 4509109107622913,
            "span.name": "gen_ai.chat",
            "span.status": "ok",
            "gen_ai.operation.type": "ai_client",
            "gen_ai.input.messages": "[{\\"role\\":\\"system\\",\\"content\\":\\"You are a helpful assistant.\\"},{\\"role\\":\\"user\\",\\"content\\":\\"What failed in production?\\"}]",
            "gen_ai.output.messages": "[{\\"role\\":\\"assistant\\",\\"content\\":\\"The checkout worker is timing out.\\"}]",
            "gen_ai.usage.total_tokens": 42,
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.response.model": "gpt-5-mini-2026-05-01",
            "gen_ai.agent.name": "triage-agent",
            "user.email": "dev@example.com"
          },
          {
            "gen_ai.conversation.id": "conv-123",
            "span_id": "2222222222222222",
            "trace": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "parent_span": "1111111111111111",
            "precise.start_ts": 1713805401.7,
            "precise.finish_ts": 1713805402,
            "project": "mcp-server",
            "project.id": 4509109107622913,
            "span.name": "gen_ai.execute_tool",
            "span.status": "ok",
            "gen_ai.operation.type": "tool",
            "gen_ai.tool.name": "search_events",
            "gen_ai.tool.call.arguments": "{\\"query\\":\\"level:error\\"}",
            "gen_ai.tool.input": "{\\"organizationSlug\\":\\"test-org\\"}"
          },
          {
            "gen_ai.conversation.id": "conv-123",
            "span_id": "3333333333333333",
            "trace": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "parent_span": null,
            "precise.start_ts": 1713805404,
            "precise.finish_ts": 1713805405,
            "project": "mcp-server",
            "project.id": 4509109107622913,
            "span.name": "gen_ai.chat",
            "span.status": "ok",
            "gen_ai.operation.type": "ai_client",
            "gen_ai.input.messages": "[{\\"role\\":\\"user\\",\\"content\\":\\"Can you inspect the failing event?\\"}]",
            "gen_ai.response.text": "I found the timeout stack trace.",
            "gen_ai.usage.total_tokens": 58
          }
        ]
      }
      \`\`\`"
    `);
  });

  it("resolves an Explore conversation URL through get_sentry_resource", async () => {
    mockConversationEndpoint("sentry-mcp-evals");

    const result = await getSentryResource.handler(
      {
        url: "https://sentry-mcp-evals.sentry.io/explore/conversations/conv-123/",
      },
      baseContext,
    );

    expect(result).toContain("# AI Conversation `conv-123`");
    expect(result).toContain("The checkout worker is timing out.");
  });

  it("preserves repeated messages and their distinct tool calls", async () => {
    mockConversationEndpoint("test-org", "conv-repeat", [
      {
        ...conversationSpans[0],
        "gen_ai.conversation.id": "conv-repeat",
        "precise.start_ts": 1713805400,
        "precise.finish_ts": 1713805401,
        span_id: "repeat-ai-1",
        "gen_ai.input.messages": JSON.stringify([
          { role: "user", content: "try again" },
        ]),
        "gen_ai.output.messages": JSON.stringify([
          { role: "assistant", content: "I will retry that." },
        ]),
      },
      {
        ...conversationSpans[1],
        "gen_ai.conversation.id": "conv-repeat",
        "precise.start_ts": 1713805402,
        "precise.finish_ts": 1713805403,
        span_id: "repeat-tool-1",
        "gen_ai.tool.name": "search_events",
      },
      {
        ...conversationSpans[0],
        "gen_ai.conversation.id": "conv-repeat",
        "precise.start_ts": 1713805404,
        "precise.finish_ts": 1713805405,
        span_id: "repeat-ai-2",
        "gen_ai.input.messages": JSON.stringify([
          { role: "user", content: "try again" },
        ]),
        "gen_ai.output.messages": JSON.stringify([
          { role: "assistant", content: "I will retry that." },
        ]),
      },
    ]);

    const result = await getAIConversationDetails.handler(
      {
        organizationSlug: "test-org",
        conversationId: "conv-repeat",
      },
      baseContext,
    );

    expect(result).toContain("**Messages**: 4");
    expect(result).toContain('"messageCount": 4');
    expect(result).toContain('"spanId": "repeat-ai-1"');
    expect(result).toContain('"spanId": "repeat-ai-2"');
    expect(result).toContain("- search_events (repeat-tool-1) - ok");
  });
});
