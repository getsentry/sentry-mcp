import { mswServer } from "@sentry/mcp-server-mocks";
import { generateText } from "ai";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import searchTraces from "./search-traces";

vi.mock("@ai-sdk/openai", () => {
  const mockModel = vi.fn(() => "mocked-model");
  return {
    openai: mockModel,
    createOpenAI: vi.fn(() => mockModel),
  };
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
    tool: vi.fn(() => ({ execute: vi.fn() })),
    Output: { object: vi.fn(() => ({})) },
  };
});

const context = {
  constraints: {
    organizationSlug: null,
    regionUrl: null,
    projectSlug: null,
  },
  accessToken: "test-token",
  userId: "1",
};

function agentResponse(output: Record<string, unknown>) {
  return {
    text: JSON.stringify(output),
    experimental_output: output,
    finishReason: "stop" as const,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    warnings: [] as const,
  } as any;
}

describe("search_traces", () => {
  const mockGenerateText = vi.mocked(generateText);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENROUTER_API_KEY = "";
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/:orgSlug/environments/",
        () => HttpResponse.json([]),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/:orgSlug/events/validate/",
        () =>
          HttpResponse.json({
            valid: true,
            projects: [],
            dataset: [],
            environment: [],
            field: [],
            query: { valid: true, error: null, fields: [] },
            orderby: [],
          }),
      ),
    );
  });

  it("takes its dataset from the tool instead of a parameter", () => {
    expect(Object.keys(searchTraces.inputSchema)).toMatchInlineSnapshot(`
      [
        "organizationSlug",
        "query",
        "fields",
        "sort",
        "projectSlug",
        "period",
        "regionUrl",
        "limit",
        "includeExplanation",
      ]
    `);
  });

  it("keeps the spans dataset when the agent suggests another", async () => {
    mockGenerateText.mockResolvedValue(
      agentResponse({
        dataset: "logs",
        query: "span.op:db",
        fields: ["span.op", "span.duration", "timestamp"],
        sort: "-timestamp",
        environment: null,
        timeRange: { statsPeriod: "24h" },
        explanation: "Test query translation",
      }),
    );
    const requestedDatasets: Array<string | null> = [];
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          requestedDatasets.push(
            new URL(request.url).searchParams.get("dataset"),
          );
          return HttpResponse.json({ data: [] });
        },
      ),
    );

    await searchTraces.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "slow db queries",
        limit: 10,
        includeExplanation: false,
      },
      context,
    );

    expect(requestedDatasets).toEqual(["spans"]);
    expect(JSON.stringify(mockGenerateText.mock.calls[0])).toContain(
      "The dataset is fixed to spans",
    );
  });

  it("sends natural language queries to Seer's Traces strategy", async () => {
    const seerStartBodies: unknown[] = [];
    mswServer.use(
      http.get("https://sentry.io/api/0/organizations/test-org/", () =>
        HttpResponse.json({
          id: "1",
          slug: "test-org",
          name: "Test Org",
          features: ["gen-ai-search-agent-translate"],
          hideAiFeatures: false,
        }),
      ),
      http.post(
        "https://sentry.io/api/0/organizations/test-org/search-agent/start/",
        async ({ request }) => {
          seerStartBodies.push(await request.json());
          return HttpResponse.json({ run_id: 1, sentry_run_id: "run-uuid" });
        },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/test-org/search-agent/state/run-uuid/",
        () =>
          HttpResponse.json({
            sentry_run_id: "run-uuid",
            session: {
              status: "completed",
              final_response: {
                responses: [
                  {
                    query: "span.op:http.client",
                    group_by: [],
                    visualization: [],
                    sort: "-span.duration",
                    stats_period: "24h",
                    start: null,
                    end: null,
                    mode: "samples",
                  },
                ],
                unsupported_reason: null,
              },
            },
          }),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("spans");
          expect(url.searchParams.get("query")).toBe("span.op:http.client");
          return HttpResponse.json({ data: [] });
        },
      ),
    );

    const result = await searchTraces.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "slowest api calls in the last 24 hours",
        limit: 10,
        includeExplanation: true,
      },
      { ...context, experimentalMode: true },
    );

    expect(seerStartBodies).toEqual([
      {
        project_ids: [-1],
        natural_language_query: "slowest api calls in the last 24 hours",
        strategy: "Traces",
      },
    ]);
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(result).toContain("Translated by Seer's search agent.");
  });
});
