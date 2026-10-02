import { mswServer } from "@sentry/mcp-server-mocks";
import { generateText } from "ai";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import searchLogs from "./search-logs";

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

describe("search_logs", () => {
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
    expect(Object.keys(searchLogs.inputSchema)).toMatchInlineSnapshot(`
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

  it("keeps the logs dataset when the agent suggests another", async () => {
    mockGenerateText.mockResolvedValue(
      agentResponse({
        dataset: "errors",
        query: "severity:error",
        fields: ["timestamp", "message", "severity"],
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

    await searchLogs.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "error logs from the last hour",
        limit: 10,
        includeExplanation: false,
      },
      context,
    );

    expect(requestedDatasets).toEqual(["logs"]);
    expect(JSON.stringify(mockGenerateText.mock.calls[0])).toContain(
      "The dataset is fixed to logs",
    );
  });
});
