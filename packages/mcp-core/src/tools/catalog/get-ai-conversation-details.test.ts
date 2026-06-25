import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import getAIConversationDetails from "./get-ai-conversation-details";
import getSentryResource from "./get-sentry-resource";
import {
  assertStructuredOnlyResult,
  getStructuredContent,
} from "../../test-utils/structured-content";

const baseContext = {
  constraints: {
    organizationSlug: undefined,
  },
  accessToken: "access-token",
  userId: "1",
};

const conversationSpans: Array<Record<string, unknown>> = [
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
  it("returns structured conversation details", async () => {
    mockConversationEndpoint();

    const result = await getAIConversationDetails.handler(
      {
        organizationSlug: "test-org",
        conversationId: "conv-123",
      },
      baseContext,
    );

    assertStructuredOnlyResult(result);
    const structuredContent = getStructuredContent(result);
    expect(structuredContent).not.toHaveProperty("lookupWindow");
    expect(structuredContent).not.toHaveProperty("focusedSpanId");
    expect(structuredContent).not.toHaveProperty("focusedSpanPresent");
    expect(structuredContent).not.toHaveProperty("messages");
    expect(structuredContent).not.toHaveProperty("spanIds");
    expect(structuredContent).toMatchInlineSnapshot(`
      {
        "conversationId": "conv-123",
        "endTimestamp": 1713805405,
        "messageCount": 4,
        "organizationSlug": "test-org",
        "projects": [
          "mcp-server",
        ],
        "spanCount": 3,
        "startTimestamp": 1713805400,
        "toolCallCount": 1,
        "totalTokens": 100,
        "traceIds": [
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ],
        "turnCount": 2,
        "turns": [
          {
            "assistant": {
              "content": "The checkout worker is timing out.",
              "role": "assistant",
              "spanId": "1111111111111111",
              "timestamp": 1713805401.5,
            },
            "durationMs": 1500,
            "ended": 1713805401.5,
            "metadata": {
              "agentName": "triage-agent",
              "model": "gpt-5-mini-2026-05-01",
              "status": "ok",
              "totalTokens": 42,
            },
            "project": "mcp-server",
            "spanId": "1111111111111111",
            "started": 1713805400,
            "toolCalls": [
              {
                "arguments": "{"query":"level:error"}",
                "durationMs": 300,
                "input": "{"organizationSlug":"test-org"}",
                "name": "search_events",
                "spanId": "2222222222222222",
                "status": "ok",
                "timestamp": 1713805401.7,
              },
            ],
            "traceId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "turn": 1,
            "user": {
              "content": "What failed in production?",
              "role": "user",
              "spanId": "1111111111111111",
              "timestamp": 1713805400,
            },
          },
          {
            "assistant": {
              "content": "I found the timeout stack trace.",
              "role": "assistant",
              "spanId": "3333333333333333",
              "timestamp": 1713805405,
            },
            "durationMs": 1000,
            "ended": 1713805405,
            "metadata": {
              "status": "ok",
              "totalTokens": 58,
            },
            "project": "mcp-server",
            "spanId": "3333333333333333",
            "started": 1713805404,
            "toolCalls": [],
            "traceId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "turn": 2,
            "user": {
              "content": "Can you inspect the failing event?",
              "role": "user",
              "spanId": "3333333333333333",
              "timestamp": 1713805404,
            },
          },
        ],
        "url": "https://test-org.sentry.io/explore/conversations/conv-123/",
      }
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

    assertStructuredOnlyResult(result);
    const structuredContent = getStructuredContent(result);
    expect(structuredContent.conversationId).toBe("conv-123");
    expect(structuredContent.turns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assistant: expect.objectContaining({
            content: "The checkout worker is timing out.",
          }),
        }),
      ]),
    );
  });

  it("preserves scoped query parameters from conversation URLs", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/ai-conversations/conv-123/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("statsPeriod")).toBeNull();
          expect(url.searchParams.get("start")).toBe(
            "2026-05-23T00:23:27.667Z",
          );
          expect(url.searchParams.get("end")).toBe("2026-05-23T02:34:56.137Z");
          expect(url.searchParams.get("project")).toBe("4510944073809921");
          return HttpResponse.json(conversationSpans);
        },
      ),
    );

    const result = await getSentryResource.handler(
      {
        url: "https://sentry-mcp-evals.sentry.io/explore/conversations/conv-123/?start=2026-05-23T00:23:27.667Z&end=2026-05-23T02:34:56.137Z&project=4510944073809921&spanId=1111111111111111",
      },
      baseContext,
    );

    const structuredContent = getStructuredContent(result);
    expect(structuredContent).toMatchObject({
      conversationId: "conv-123",
      turnCount: 2,
      traceIds: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });
  });

  it("describes explicit lookup windows when no spans are found", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/ai-conversations/conv-empty/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("statsPeriod")).toBeNull();
          expect(url.searchParams.get("start")).toBe(
            "2026-05-23T00:23:27.667Z",
          );
          expect(url.searchParams.get("end")).toBe("2026-05-23T02:34:56.137Z");
          return HttpResponse.json([]);
        },
      ),
    );

    const result = await getAIConversationDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        conversationId: "conv-empty",
        start: "2026-05-23T00:23:27.667Z",
        end: "2026-05-23T02:34:56.137Z",
      },
      baseContext,
    );

    assertStructuredOnlyResult(result);
    expect(getStructuredContent(result)).toMatchObject({
      conversationId: "conv-empty",
      startTimestamp: null,
      endTimestamp: null,
      spanCount: 0,
      turnCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      turns: [],
    });
  });

  it("rejects partial absolute time ranges", async () => {
    await expect(
      getAIConversationDetails.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          conversationId: "conv-123",
          start: "2026-05-23T00:23:27.667Z",
        },
        baseContext,
      ),
    ).rejects.toThrow("`start` and `end` must be provided together.");
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

    const structuredContent = getStructuredContent(result);
    expect(structuredContent.messageCount).toBe(4);
    expect(structuredContent.turns).toMatchObject([
      {
        turn: 1,
        spanId: "repeat-ai-1",
        toolCalls: [{ name: "search_events", spanId: "repeat-tool-1" }],
      },
      {
        turn: 2,
        spanId: "repeat-ai-2",
        toolCalls: [],
      },
    ]);
  });

  it("attaches tool calls after the final AI client span", async () => {
    mockConversationEndpoint("test-org", "conv-final-tool", [
      {
        ...conversationSpans[0],
        "gen_ai.conversation.id": "conv-final-tool",
        "precise.start_ts": 1713805400,
        "precise.finish_ts": 1713805401,
        span_id: "final-ai-1",
        "gen_ai.input.messages": JSON.stringify([
          { role: "user", content: "check the latest event" },
        ]),
        "gen_ai.output.messages": JSON.stringify([
          { role: "assistant", content: "I will inspect that event." },
        ]),
      },
      {
        ...conversationSpans[1],
        "gen_ai.conversation.id": "conv-final-tool",
        "precise.start_ts": 1713805402,
        "precise.finish_ts": 1713805403,
        span_id: "final-tool-1",
        "gen_ai.tool.name": "get_issue_details",
      },
    ]);

    const result = await getAIConversationDetails.handler(
      {
        organizationSlug: "test-org",
        conversationId: "conv-final-tool",
      },
      baseContext,
    );

    const structuredContent = getStructuredContent(result);
    expect(structuredContent.toolCallCount).toBe(1);
    expect(structuredContent.turns).toMatchObject([
      {
        toolCalls: [
          { name: "get_issue_details", spanId: "final-tool-1", status: "ok" },
        ],
      },
    ]);
  });

  it("counts only tool calls included in the transcript", async () => {
    const unnamedToolSpan: Record<string, unknown> = {
      ...conversationSpans[1],
      "gen_ai.conversation.id": "conv-unnamed-tool",
      "precise.start_ts": 1713805402,
      "precise.finish_ts": 1713805403,
      span_id: "unnamed-tool-1",
      "gen_ai.tool.name": undefined,
    };

    mockConversationEndpoint("test-org", "conv-unnamed-tool", [
      {
        ...conversationSpans[0],
        "gen_ai.conversation.id": "conv-unnamed-tool",
        "precise.start_ts": 1713805400,
        "precise.finish_ts": 1713805401,
        span_id: "unnamed-ai-1",
      },
      unnamedToolSpan,
    ]);

    const result = await getAIConversationDetails.handler(
      {
        organizationSlug: "test-org",
        conversationId: "conv-unnamed-tool",
      },
      baseContext,
    );

    const structuredContent = getStructuredContent(result);
    expect(structuredContent.toolCallCount).toBe(0);
    expect(structuredContent.turns).toMatchObject([{ toolCalls: [] }]);
  });
});
