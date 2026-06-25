import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { mswServer } from "@sentry/mcp-server-mocks";
import searchAIConversations from "./search-ai-conversations";
import catalogTools from "./index";
import { isDefaultTopLevelToolName } from "../surfaces";
import { getServerContext } from "../../test-setup";

const baseConversation = {
  conversationId: "conv-123",
  flow: ["triage-agent"],
  errors: 1,
  llmCalls: 2,
  toolCalls: 1,
  totalTokens: 1200,
  totalCost: 0.012,
  startTimestamp: 1713805400000,
  endTimestamp: 1713805415000,
  traceCount: 1,
  traceIds: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  firstInput: "What failed in checkout?",
  lastOutput: "The checkout worker is timing out.",
  user: {
    id: "1",
    email: "dev@example.com",
    username: "dev",
    ip_address: "127.0.0.1",
    backendOnlyField: "do-not-leak",
  },
  toolNames: ["search_events"],
  toolErrors: 1,
};

function getTextContent(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return content?.find((item) => typeof item.text === "string")?.text ?? "";
}

function getStructuredContent<T extends Record<string, unknown>>(
  result: unknown,
): T {
  const structuredContent = (result as { structuredContent?: unknown })
    .structuredContent;
  if (
    !structuredContent ||
    typeof structuredContent !== "object" ||
    Array.isArray(structuredContent)
  ) {
    throw new Error(`No structured content found: ${JSON.stringify(result)}`);
  }

  return structuredContent as T;
}

describe("search_ai_conversations", () => {
  it("returns conversation-shaped search results", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/ai-conversations/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("query")).toBe("checkout");
          expect(url.searchParams.get("sort")).toBe(null);
          expect(url.searchParams.get("statsPeriod")).toBe("7d");
          expect(url.searchParams.get("per_page")).toBe("10");
          return HttpResponse.json([baseConversation]);
        },
      ),
    );

    const result = await searchAIConversations.handler(
      {
        organizationSlug: "test-org",
        query: "checkout",
        statsPeriod: "7d",
        limit: 10,
      },
      getServerContext(),
    );

    const text = getTextContent(result);
    const structuredContent = getStructuredContent<{
      organizationSlug: string;
      searchUrl: string;
      count: number;
      conversations: Array<{
        conversationId: string;
        url: string;
        durationMs: number;
        user: Record<string, unknown> | null;
      }>;
    }>(result);

    expect(structuredContent).toMatchObject({
      organizationSlug: "test-org",
      searchUrl:
        "https://test-org.sentry.io/explore/conversations/?query=checkout&statsPeriod=7d",
      count: 1,
      conversations: [
        {
          conversationId: "conv-123",
          url: "https://test-org.sentry.io/explore/conversations/conv-123/",
          durationMs: 15000,
          user: {
            id: "1",
            email: "dev@example.com",
            username: "dev",
            ip_address: "127.0.0.1",
          },
        },
      ],
    });
    expect(structuredContent.conversations[0]?.user).not.toHaveProperty(
      "backendOnlyField",
    );
    expect(text).toMatchInlineSnapshot(`
      "# AI Conversations in **test-org**

      ## Executed Search
      - Query: \`checkout\`
      - Order: backend default (most recent activity first)
      - Limit: 10
      - Time range: Last 7d

      **Sentry Search URL**: https://test-org.sentry.io/explore/conversations/?query=checkout&statsPeriod=7d

      Found 1 AI conversation.

      ## conv-123

      **URL**: https://test-org.sentry.io/explore/conversations/conv-123/
      **Started**: 2024-04-22T17:03:20.000Z
      **Ended**: 2024-04-22T17:03:35.000Z
      **Duration**: 15s
      **User**: dev@example.com
      **Errors**: 1
      **LLM Calls**: 2
      **Tool Calls**: 1
      **Tool Errors**: 1
      **Total Tokens**: 1200
      **Total Cost**: 0.012
      **Trace Count**: 1
      **Flow**: triage-agent
      **Tools**: search_events
      **Trace IDs**: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

      **First Input**

      What failed in checkout?

      **Last Output**

      The checkout worker is timing out.

      ## Next Steps

      - Fetch a transcript with \`get_ai_conversation_details\` using a \`conversationId\` above.
      - Fetch by URL with \`get_sentry_resource\` using a conversation URL above.
      - Query related spans with \`search_events\` using dataset \`spans\` and query \`gen_ai.conversation.id:<conversationId>\` to inspect telemetry across traces.
      - Use listed trace IDs only for per-trace follow-up; a conversation can span multiple traces.

      ## Structured Artifact

      \`\`\`json
      {
        "organizationSlug": "test-org",
        "searchUrl": "https://test-org.sentry.io/explore/conversations/?query=checkout&statsPeriod=7d",
        "count": 1,
        "nextCursor": null,
        "conversations": [
          {
            "conversationId": "conv-123",
            "flow": [
              "triage-agent"
            ],
            "errors": 1,
            "llmCalls": 2,
            "toolCalls": 1,
            "totalTokens": 1200,
            "totalCost": 0.012,
            "startTimestamp": 1713805400000,
            "endTimestamp": 1713805415000,
            "traceCount": 1,
            "traceIds": [
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            ],
            "firstInput": "What failed in checkout?",
            "lastOutput": "The checkout worker is timing out.",
            "user": {
              "id": "1",
              "email": "dev@example.com",
              "username": "dev",
              "ip_address": "127.0.0.1"
            },
            "toolNames": [
              "search_events"
            ],
            "toolErrors": 1,
            "url": "https://test-org.sentry.io/explore/conversations/conv-123/",
            "durationMs": 15000
          }
        ]
      }
      \`\`\`"
    `);
  });

  it("defaults searches to the same 30d window as detail lookups", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/ai-conversations/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("statsPeriod")).toBe("30d");
          expect(url.searchParams.get("start")).toBe(null);
          expect(url.searchParams.get("end")).toBe(null);
          expect(url.searchParams.get("per_page")).toBe("10");
          return HttpResponse.json([]);
        },
      ),
    );

    const result = await searchAIConversations.handler(
      {
        organizationSlug: "test-org",
        limit: 10,
      },
      getServerContext(),
    );

    const text = getTextContent(result);
    const structuredContent = getStructuredContent<{
      searchUrl: string;
    }>(result);

    expect(text).toContain("- Time range: Last 30d");
    expect(structuredContent.searchUrl).toBe(
      "https://test-org.sentry.io/explore/conversations/?statsPeriod=30d",
    );
  });

  it("treats an empty statsPeriod like the default search window", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/ai-conversations/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("statsPeriod")).toBe("30d");
          expect(url.searchParams.get("per_page")).toBe("10");
          return HttpResponse.json([]);
        },
      ),
    );

    const result = await searchAIConversations.handler(
      {
        organizationSlug: "test-org",
        statsPeriod: "   ",
        limit: 10,
      },
      getServerContext(),
    );

    const structuredContent = getStructuredContent<{
      searchUrl: string;
    }>(result);

    expect(structuredContent.searchUrl).toBe(
      "https://test-org.sentry.io/explore/conversations/?statsPeriod=30d",
    );
  });

  it("passes filters, resolves project slugs, and returns pagination hints", async () => {
    const requestUrls: string[] = [];
    mswServer.use(
      http.get("https://sentry.io/api/0/projects/test-org/backend/", () =>
        HttpResponse.json({
          id: "4509109107622913",
          slug: "backend",
          name: "backend",
        }),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/test-org/ai-conversations/",
        ({ request }) => {
          requestUrls.push(request.url);
          return HttpResponse.json([], {
            headers: {
              Link: '<https://sentry.io/api/0/organizations/test-org/ai-conversations/?cursor=page-2>; rel="next"; results="true"; cursor="page-2"',
            },
          });
        },
      ),
    );

    const result = await searchAIConversations.handler(
      {
        organizationSlug: "test-org",
        query: "failed",
        samplingMode: "HIGHEST_ACCURACY",
        project: "backend",
        environment: ["production", "staging"],
        start: "2026-06-01T00:00:00Z",
        end: "2026-06-02T00:00:00Z",
        cursor: "page-1",
        limit: 25,
      },
      getServerContext(),
    );

    const params = new URL(requestUrls[0]!).searchParams;
    expect(params.get("query")).toBe("failed");
    expect(params.get("sort")).toBe(null);
    expect(params.get("samplingMode")).toBe("HIGHEST_ACCURACY");
    expect(params.getAll("project")).toEqual(["4509109107622913"]);
    expect(params.getAll("environment")).toEqual(["production", "staging"]);
    expect(params.get("statsPeriod")).toBe(null);
    expect(params.get("start")).toBe("2026-06-01T00:00:00Z");
    expect(params.get("end")).toBe("2026-06-02T00:00:00Z");
    expect(params.get("cursor")).toBe("page-1");
    expect(params.get("per_page")).toBe("25");
    const text = getTextContent(result);
    const structuredContent = getStructuredContent<{
      count: number;
      nextCursor: string | null;
      conversations: unknown[];
    }>(result);

    expect(text).toContain("No AI conversations found.");
    expect(text).toContain('cursor: "page-2"');
    expect(structuredContent).toMatchObject({
      count: 0,
      nextCursor: "page-2",
      conversations: [],
    });
  });

  it("rejects conflicting relative and absolute time ranges", async () => {
    await expect(
      searchAIConversations.handler(
        {
          organizationSlug: "test-org",
          statsPeriod: "7d",
          start: "2026-06-01T00:00:00Z",
          end: "2026-06-02T00:00:00Z",
          limit: 10,
        },
        getServerContext(),
      ),
    ).rejects.toThrow(
      "`statsPeriod` cannot be combined with `start` and `end`.",
    );
  });

  it("rejects partial absolute time ranges", async () => {
    await expect(
      searchAIConversations.handler(
        {
          organizationSlug: "test-org",
          start: "2026-06-01T00:00:00Z",
          limit: 10,
        },
        getServerContext(),
      ),
    ).rejects.toThrow("`start` and `end` must be provided together.");
  });

  it("is catalog-only", () => {
    expect(catalogTools.search_ai_conversations).toBe(searchAIConversations);
    expect(isDefaultTopLevelToolName("search_ai_conversations")).toBe(false);
  });
});
