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
  it("returns a transcript", async () => {
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
      **Turns**: 2
      **Messages**: 4
      **Tool Calls**: 1
      **Spans**: 3
      **Total Tokens**: 100

      ## View in Sentry

      https://test-org.sentry.io/explore/conversations/conv-123/

      ## Related Telemetry

      - Query spans with \`search_events\` using dataset \`spans\` and query \`gen_ai.conversation.id:conv-123\` to inspect telemetry across traces.
      - This conversation spans 1 trace: \`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\`. Inspect trace IDs individually only when you need trace-local context.

      ## Transcript

      ### Turn 1 - 2024-04-22T17:03:20.000Z

      _gpt-5-mini-2026-05-01 | triage-agent | 42 tokens | 1.5s | ok_

      **User**

      What failed in production?

      **Assistant**

      The checkout worker is timing out.

      **Tools**

      - search_events (2222222222222222) - ok - 300ms

        Arguments:

        \`\`\`json
        {
          "query": "level:error"
        }
        \`\`\`

        Input:

        \`\`\`json
        {
          "organizationSlug": "test-org"
        }
        \`\`\`

      ### Turn 2 - 2024-04-22T17:03:24.000Z

      _58 tokens | 1s | ok_

      **User**

      Can you inspect the failing event?

      **Assistant**

      I found the timeout stack trace.
      "
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

    expect(result).toContain("**Focused Span**: 1111111111111111");
    expect(result).toContain("**Focused Span Present**: yes");
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

    expect(result).toContain(
      "No AI spans found for this conversation between 2026-05-23T00:23:27.667Z and 2026-05-23T02:34:56.137Z.",
    );
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

    expect(result).toContain("**Messages**: 4");
    expect(result).toContain("### Turn 1 - 2024-04-22T17:03:20.000Z");
    expect(result).toContain("### Turn 2 - 2024-04-22T17:03:24.000Z");
    expect(result).toContain("- search_events (repeat-tool-1) - ok");
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

    expect(result).toContain("**Tool Calls**: 1");
    expect(result).toContain("- get_issue_details (final-tool-1) - ok");
    expect(result).toContain("**Tools**");
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

    expect(result).toContain("**Tool Calls**: 0");
    expect(result).not.toContain("**Tools**");
    expect(result).not.toContain("(unnamed-tool-1)");
  });
});
