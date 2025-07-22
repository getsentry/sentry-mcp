import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import searchEvents from "./search-events";
import { generateText, tool, Output } from "ai";

// Mock the AI SDK
vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn(() => "mocked-model"),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
  tool: vi.fn(() => ({ execute: vi.fn() })),
  Output: { object: vi.fn(() => ({})) },
}));

describe("search_events", () => {
  const mockGenerateText = vi.mocked(generateText);

  // Helper to create AI response for different datasets
  const mockAIResponse = (
    dataset: "errors" | "logs" | "spans",
    query = "test query",
    fields?: string[],
    errorMessage?: string,
    sort?: string,
    timeRange?: { statsPeriod: string } | { start: string; end: string },
  ) => {
    const defaultFields = {
      errors: ["issue", "title", "project", "timestamp", "level", "message"],
      logs: ["timestamp", "project", "message", "severity", "trace"],
      spans: [
        "span.op",
        "span.description",
        "span.duration",
        "transaction",
        "timestamp",
        "project",
      ],
    };

    const defaultSorts = {
      errors: "-timestamp",
      logs: "-timestamp",
      spans: "-span.duration",
    };

    const output = errorMessage
      ? { error: errorMessage }
      : {
          dataset,
          query,
          fields: fields || defaultFields[dataset],
          sort: sort || defaultSorts[dataset],
          ...(timeRange && { timeRange }),
        };

    return {
      text: JSON.stringify(output),
      experimental_output: output,
      finishReason: "stop" as const,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      warnings: [] as const,
    } as any;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    mockGenerateText.mockResolvedValue(mockAIResponse("errors"));
  });

  it("should handle spans dataset queries", async () => {
    // Mock AI response for spans dataset
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse("spans", 'span.op:"db.query"', [
        "span.op",
        "span.description",
        "span.duration",
      ]),
    );

    // Mock the Sentry API response
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("spans");
          return HttpResponse.json({
            data: [
              {
                id: "span1",
                "span.op": "db.query",
                "span.description": "SELECT * FROM users",
                "span.duration": 1500,
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "database queries",
        limit: 10,
        includeExplanation: false,
      },
      {
        accessToken: "test-token",
        userId: "1",
        organizationSlug: null,
      },
    );

    expect(mockGenerateText).toHaveBeenCalled();
    expect(result).toContain("span1");
    expect(result).toContain("db.query");
  });

  it("should handle errors dataset queries", async () => {
    // Mock AI response for errors dataset
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse("errors", "level:error", [
        "issue",
        "title",
        "level",
        "timestamp",
      ]),
    );

    // Mock the Sentry API response
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("errors");
          return HttpResponse.json({
            data: [
              {
                id: "error1",
                issue: "PROJ-123",
                title: "Database Connection Error",
                level: "error",
                timestamp: "2024-01-15T10:30:00Z",
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "database errors",
        limit: 10,
        includeExplanation: false,
      },
      {
        accessToken: "test-token",
        userId: "1",
        organizationSlug: null,
      },
    );

    expect(mockGenerateText).toHaveBeenCalled();
    expect(result).toContain("Database Connection Error");
    expect(result).toContain("PROJ-123");
  });

  it("should handle logs dataset queries", async () => {
    // Mock AI response for logs dataset
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse("logs", "severity:error", [
        "timestamp",
        "message",
        "severity",
      ]),
    );

    // Mock the Sentry API response
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("ourlogs"); // API converts logs -> ourlogs
          return HttpResponse.json({
            data: [
              {
                id: "log1",
                timestamp: "2024-01-15T10:30:00Z",
                message: "Connection failed to database",
                severity: "error",
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "error logs",
        limit: 10,
        includeExplanation: false,
      },
      {
        accessToken: "test-token",
        userId: "1",
        organizationSlug: null,
      },
    );

    expect(mockGenerateText).toHaveBeenCalled();
    expect(result).toContain("Connection failed to database");
    expect(result).toContain("🔴 [ERROR]");
  });

  it("should handle AI agent errors gracefully", async () => {
    // Mock AI response with error
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse("errors", "", [], "Cannot parse this query"),
    );

    await expect(
      searchEvents.handler(
        {
          organizationSlug: "test-org",
          naturalLanguageQuery: "some impossible query !@#$%",
          limit: 10,
          includeExplanation: false,
        },
        {
          accessToken: "test-token",
          userId: "1",
          organizationSlug: null,
        },
      ),
    ).rejects.toThrow("Search Events Agent could not translate query");
  });

  it("should handle API errors gracefully", async () => {
    // Mock successful AI response
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse("errors", "level:error"),
    );

    // Mock API error
    mswServer.use(
      http.get("https://sentry.io/api/0/organizations/test-org/events/", () =>
        HttpResponse.json(
          { detail: "Organization not found" },
          { status: 404 },
        ),
      ),
    );

    await expect(
      searchEvents.handler(
        {
          organizationSlug: "test-org",
          naturalLanguageQuery: "any query",
          limit: 10,
          includeExplanation: false,
        },
        {
          accessToken: "test-token",
          userId: "1",
          organizationSlug: null,
        },
      ),
    ).rejects.toThrow();
  });

  it("should handle missing sort parameter", async () => {
    // Mock AI response missing sort parameter
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        dataset: "errors",
        query: "test",
        fields: ["title"],
      }),
      experimental_output: {
        dataset: "errors",
        query: "test",
        fields: ["title"],
      },
    } as any);

    await expect(
      searchEvents.handler(
        {
          organizationSlug: "test-org",
          naturalLanguageQuery: "any query",
          limit: 10,
          includeExplanation: false,
        },
        {
          accessToken: "test-token",
          userId: "1",
          organizationSlug: null,
        },
      ),
    ).rejects.toThrow("missing required 'sort' parameter");
  });

  it("should correctly handle user agent queries", async () => {
    // Mock AI response for user agent query in spans dataset
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse(
        "spans",
        "has:mcp.tool.name AND has:user_agent.original",
        ["user_agent.original", "count()"],
        undefined,
        "-count()",
        { statsPeriod: "24h" },
      ),
    );

    // Mock the Sentry API response
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("spans");
          expect(url.searchParams.get("query")).toBe(
            "has:mcp.tool.name AND has:user_agent.original",
          );
          expect(url.searchParams.get("sort")).toBe("-count"); // API transforms count() to count
          expect(url.searchParams.get("statsPeriod")).toBe("24h");
          // Verify it's using user_agent.original, not user.id
          expect(url.searchParams.getAll("field")).toContain(
            "user_agent.original",
          );
          expect(url.searchParams.getAll("field")).toContain("count()");
          return HttpResponse.json({
            data: [
              {
                "user_agent.original":
                  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "count()": 150,
              },
              {
                "user_agent.original":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "count()": 120,
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery:
          "which user agents have the most tool calls yesterday",
        limit: 10,
        includeExplanation: false,
      },
      {
        accessToken: "test-token",
        userId: "1",
        organizationSlug: null,
      },
    );

    expect(mockGenerateText).toHaveBeenCalled();
    expect(result).toContain("Mozilla/5.0");
    expect(result).toContain("150");
    expect(result).toContain("120");
    // Should NOT contain user.id references
    expect(result).not.toContain("user.id");
  });

  it.skip("integration test - should work with real OpenAI API", async () => {
    // This test is skipped by default but can be enabled for integration testing
    // Requires real OPENAI_API_KEY environment variable
    if (!process.env.OPENAI_API_KEY?.startsWith("sk-")) {
      return;
    }

    // Mock the Sentry API response
    mswServer.use(
      http.get("https://sentry.io/api/0/organizations/test-org/events/", () =>
        HttpResponse.json({
          data: [
            {
              id: "test1",
              timestamp: "2024-01-15T10:30:00Z",
              message: "Test error message",
              level: "error",
            },
          ],
        }),
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "error messages from today",
        limit: 5,
        includeExplanation: false,
      },
      {
        accessToken: "test-token",
        userId: "1",
        organizationSlug: null,
      },
    );

    expect(result).toContain("test1");
    expect(result).toContain("Test error message");
  });
});
