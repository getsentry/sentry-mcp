import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import searchIssueEvents from "./search-issue-events";
import { generateText } from "ai";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";

// Mock the AI SDK
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

describe("search_issue_events", () => {
  const mockGenerateText = vi.mocked(generateText);
  const mockContext: ServerContext = {
    accessToken: "test-token",
    userId: "user-123",
    clientId: "client-123",
    grantedSkills: new Set(),
    constraints: {},
    sentryHost: "sentry.io",
  };

  // Helper to create AI agent response
  const mockAIResponse = (
    query = "",
    fields?: string[],
    sort = "-timestamp",
    timeRange?: { statsPeriod: string } | { start: string; end: string } | null,
    errorMessage?: string,
  ) => {
    const defaultFields = [
      "id",
      "timestamp",
      "title",
      "message",
      "level",
      "environment",
      "release",
    ];

    const output = errorMessage
      ? { error: errorMessage }
      : {
          query,
          fields: fields || defaultFields,
          sort,
          timeRange: timeRange ?? null,
          explanation: "Test query translation",
        };

    return {
      text: JSON.stringify(output),
      experimental_output: output,
      finishReason: "stop" as const,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      warnings: [] as const,
      experimental_providerMetadata: {
        openai: {
          reasoningTokens: 0,
          cachedPromptTokens: 0,
        },
      },
    } as any;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    mockGenerateText.mockResolvedValue(mockAIResponse());
  });

  it("should search events within a specific issue with issueId", async () => {
    mockGenerateText.mockResolvedValue(
      mockAIResponse("", ["id", "timestamp", "title"], "-timestamp"),
    );

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/*/events/", ({ request }) => {
        const url = new URL(request.url);
        // Endpoint is already scoped to the issue, no issue: in query needed
        const query = url.searchParams.get("query");
        // Query param can be null or empty string when no filters
        expect(query === null || query === "").toBe(true);
        // Return array directly, not wrapped in {data: [...]}
        return HttpResponse.json([
          {
            id: "event1",
            timestamp: "2025-01-15T10:00:00Z",
            title: "Test Error",
          },
        ]);
      }),
    );

    const result = await searchIssueEvents.handler(
      {
        organizationSlug: "test-org",
        issueId: "MCP-41",
        naturalLanguageQuery: "from last hour",
        projectSlug: null,
        regionUrl: null,
        limit: 50,
        includeExplanation: false,
      },
      mockContext,
    );

    expect(result).toContain("Events in issue MCP-41");
    expect(result).toContain("Test Error");
    expect(result).toContain("2025-01-15T10:00:00Z");
  });

  it("should parse issueUrl and extract organization and issue ID", async () => {
    mockGenerateText.mockResolvedValue(mockAIResponse());

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/*/events/", ({ request }) => {
        const url = new URL(request.url);
        // Endpoint is scoped to issue, query param can be null or empty
        const query = url.searchParams.get("query");
        expect(query === null || query === "").toBe(true);
        return HttpResponse.json([]);
      }),
    );

    const result = await searchIssueEvents.handler(
      {
        organizationSlug: null,
        issueUrl: "https://sentry.io/organizations/my-org/issues/123/",
        naturalLanguageQuery: "all events",
        projectSlug: null,
        regionUrl: null,
        limit: 50,
        includeExplanation: false,
      },
      mockContext,
    );

    expect(result).toContain("Events in issue 123");
  });

  it("should pass user filters to the query parameter", async () => {
    mockGenerateText.mockResolvedValue(
      mockAIResponse(
        "environment:production release:v1.0",
        ["id", "timestamp", "environment", "release"],
        "-timestamp",
      ),
    );

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/*/events/", ({ request }) => {
        const url = new URL(request.url);
        const query = url.searchParams.get("query");
        // Endpoint is scoped to issue, so only user filters in query
        expect(query).toBe("environment:production release:v1.0");
        return HttpResponse.json([]);
      }),
    );

    await searchIssueEvents.handler(
      {
        organizationSlug: "test-org",
        issueId: "MCP-41",
        naturalLanguageQuery: "production with release v1.0",
        projectSlug: null,
        regionUrl: null,
        limit: 50,
        includeExplanation: false,
      },
      mockContext,
    );
  });

  it("should handle time range with statsPeriod", async () => {
    mockGenerateText.mockResolvedValue(
      mockAIResponse("", ["id", "timestamp", "title"], "-timestamp", {
        statsPeriod: "1h",
      }),
    );

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/*/events/", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("statsPeriod")).toBe("1h");
        return HttpResponse.json([]);
      }),
    );

    await searchIssueEvents.handler(
      {
        organizationSlug: "test-org",
        issueId: "MCP-41",
        naturalLanguageQuery: "from last hour",
        projectSlug: null,
        regionUrl: null,
        limit: 50,
        includeExplanation: false,
      },
      mockContext,
    );
  });

  it("should handle absolute time range", async () => {
    mockGenerateText.mockResolvedValue(
      mockAIResponse("", ["id", "timestamp", "title"], "-timestamp", {
        start: "2025-01-15T00:00:00Z",
        end: "2025-01-16T00:00:00Z",
      }),
    );

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/*/events/", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("start")).toBe("2025-01-15T00:00:00Z");
        expect(url.searchParams.get("end")).toBe("2025-01-16T00:00:00Z");
        return HttpResponse.json([]);
      }),
    );

    await searchIssueEvents.handler(
      {
        organizationSlug: "test-org",
        issueId: "MCP-41",
        naturalLanguageQuery: "from Jan 15 2025",
        projectSlug: null,
        regionUrl: null,
        limit: 50,
        includeExplanation: false,
      },
      mockContext,
    );
  });

  it("should use default 14d time window when no timeRange specified", async () => {
    mockGenerateText.mockResolvedValue(
      mockAIResponse("", ["id", "timestamp"], "-timestamp", null),
    );

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/*/events/", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("statsPeriod")).toBe("14d");
        return HttpResponse.json([]);
      }),
    );

    await searchIssueEvents.handler(
      {
        organizationSlug: "test-org",
        issueId: "MCP-41",
        naturalLanguageQuery: "all events",
        projectSlug: null,
        regionUrl: null,
        limit: 50,
        includeExplanation: false,
      },
      mockContext,
    );
  });

  it("should validate sort field is included in fields array", async () => {
    // Agent returns sort field not in fields array (validation should fail)
    mockGenerateText.mockResolvedValue(
      mockAIResponse("", ["id", "title"], "-timestamp"), // timestamp not in fields!
    );

    await expect(
      searchIssueEvents.handler(
        {
          organizationSlug: "test-org",
          issueId: "MCP-41",
          naturalLanguageQuery: "test query",
          projectSlug: null,
          regionUrl: null,
          limit: 50,
          includeExplanation: false,
        },
        mockContext,
      ),
    ).rejects.toThrow();
  });

  it("should handle empty results", async () => {
    mockGenerateText.mockResolvedValue(mockAIResponse());

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/*/events/", () => {
        return HttpResponse.json([]);
      }),
    );

    const result = await searchIssueEvents.handler(
      {
        organizationSlug: "test-org",
        issueId: "MCP-41",
        naturalLanguageQuery: "from last hour",
        projectSlug: null,
        regionUrl: null,
        limit: 50,
        includeExplanation: false,
      },
      mockContext,
    );

    expect(result).toContain("No results found");
  });

  it("should throw error when neither issueId nor issueUrl provided", async () => {
    await expect(
      searchIssueEvents.handler(
        {
          organizationSlug: "test-org",
          naturalLanguageQuery: "test",
          projectSlug: null,
          regionUrl: null,
          limit: 50,
          includeExplanation: false,
        },
        mockContext,
      ),
    ).rejects.toThrow(UserInputError);
  });

  it("should throw error when issueId provided without organizationSlug", async () => {
    await expect(
      searchIssueEvents.handler(
        {
          organizationSlug: null,
          issueId: "MCP-41",
          naturalLanguageQuery: "test",
          projectSlug: null,
          regionUrl: null,
          limit: 50,
          includeExplanation: false,
        },
        mockContext,
      ),
    ).rejects.toThrow(UserInputError);
  });

  it("should throw error for invalid issueUrl format", async () => {
    await expect(
      searchIssueEvents.handler(
        {
          organizationSlug: null,
          issueUrl: "https://invalid-url.com",
          naturalLanguageQuery: "test",
          projectSlug: null,
          regionUrl: null,
          limit: 50,
          includeExplanation: false,
        },
        mockContext,
      ),
    ).rejects.toThrow(UserInputError);
  });

  it("should pass through agent query without modification", async () => {
    // Test that the query from the agent is passed directly to the API
    mockGenerateText.mockResolvedValue(
      mockAIResponse(
        "environment:production",
        ["id", "timestamp", "environment"],
        "-timestamp",
      ),
    );

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/*/events/", ({ request }) => {
        const url = new URL(request.url);
        const query = url.searchParams.get("query");
        // No issue: prefix needed - endpoint handles it
        expect(query).toBe("environment:production");
        return HttpResponse.json([]);
      }),
    );

    await searchIssueEvents.handler(
      {
        organizationSlug: "test-org",
        issueId: "MCP-41",
        naturalLanguageQuery: "production events",
        projectSlug: null,
        regionUrl: null,
        limit: 50,
        includeExplanation: false,
      },
      mockContext,
    );
  });

  it("should respect custom limit parameter", async () => {
    mockGenerateText.mockResolvedValue(mockAIResponse());

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/*/events/", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("per_page")).toBe("25");
        return HttpResponse.json([]);
      }),
    );

    await searchIssueEvents.handler(
      {
        organizationSlug: "test-org",
        issueId: "MCP-41",
        naturalLanguageQuery: "test",
        projectSlug: null,
        regionUrl: null,
        limit: 25,
        includeExplanation: false,
      },
      mockContext,
    );
  });

  it("should include explanation when requested", async () => {
    mockGenerateText.mockResolvedValue(
      mockAIResponse(
        "environment:production",
        ["id", "timestamp"],
        "-timestamp",
        null,
      ),
    );

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/*/events/", () => {
        return HttpResponse.json([]);
      }),
    );

    const result = await searchIssueEvents.handler(
      {
        organizationSlug: "test-org",
        issueId: "MCP-41",
        naturalLanguageQuery: "production events",
        projectSlug: null,
        regionUrl: null,
        limit: 50,
        includeExplanation: true,
      },
      mockContext,
    );

    expect(result).toContain("How I interpreted your query");
  });

  it("should parse alternative issueUrl format (subdomain)", async () => {
    mockGenerateText.mockResolvedValue(mockAIResponse());

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/*/events/", ({ request }) => {
        const url = new URL(request.url);
        // Endpoint is scoped to issue, query param can be null or empty
        const query = url.searchParams.get("query");
        expect(query === null || query === "").toBe(true);
        return HttpResponse.json([]);
      }),
    );

    await searchIssueEvents.handler(
      {
        organizationSlug: null,
        issueUrl: "https://my-org.sentry.io/issues/456/",
        naturalLanguageQuery: "test",
        projectSlug: null,
        regionUrl: null,
        limit: 50,
        includeExplanation: false,
      },
      mockContext,
    );
  });
});
