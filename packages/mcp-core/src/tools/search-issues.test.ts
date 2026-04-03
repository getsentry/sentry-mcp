import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import searchIssues from "./search-issues";
import { generateText } from "ai";
import type { ServerContext } from "../types";
import { ConfigurationError } from "../errors";

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

describe("search_issues", () => {
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
    sort: "date" | "freq" | "new" | "user" | null = "date",
    errorMessage?: string,
  ) => {
    const output = errorMessage
      ? { error: errorMessage }
      : {
          query,
          sort,
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

  it("should search issues with natural language query", async () => {
    mockGenerateText.mockResolvedValue(mockAIResponse("is:unresolved", "date"));

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/", ({ request }) => {
        const url = new URL(request.url);
        const query = url.searchParams.get("query");
        expect(query).toBe("is:unresolved");
        return HttpResponse.json([
          {
            id: "123",
            shortId: "PROJ-123",
            title: "Test Error",
            status: "unresolved",
            count: "100",
            userCount: 50,
            firstSeen: "2025-01-15T10:00:00Z",
            lastSeen: "2025-01-15T12:00:00Z",
            permalink: "https://sentry.io/issues/123/",
            project: {
              id: "456",
              slug: "test-project",
              name: "Test Project",
            },
            culprit: "test.function",
          },
        ]);
      }),
    );

    const result = await searchIssues.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "unresolved issues",
        query: "is:unresolved",
        sort: "date",
        projectSlugOrId: null,
        regionUrl: null,
        limit: 10,
        includeExplanation: false,
      },
      mockContext,
    );

    expect(result).toContain("PROJ-123");
    expect(result).toContain("Test Error");
  });

  it("should search issues with direct query syntax (no agent)", async () => {
    mswServer.use(
      http.get("*/api/0/organizations/*/issues/", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("query")).toBe(
          "is:unresolved is:unassigned",
        );
        expect(url.searchParams.get("sort")).toBe("freq");
        return HttpResponse.json([
          {
            id: "123",
            shortId: "PROJ-123",
            title: "Test Error",
            status: "unresolved",
            count: "100",
            userCount: 50,
            firstSeen: "2025-01-15T10:00:00Z",
            lastSeen: "2025-01-15T12:00:00Z",
            permalink: "https://sentry.io/issues/123/",
            project: {
              id: "456",
              slug: "test-project",
              name: "Test Project",
            },
            culprit: "test.function",
          },
        ]);
      }),
    );

    const result = await searchIssues.handler(
      {
        organizationSlug: "test-org",
        query: "is:unresolved is:unassigned",
        sort: "freq",
        projectSlugOrId: null,
        regionUrl: null,
        limit: 10,
        includeExplanation: false,
      },
      mockContext,
    );

    // Should NOT have called the AI agent
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(result).toContain("PROJ-123");
    expect(result).toContain("Test Error");
  });

  it("should throw ConfigurationError when naturalLanguageQuery provided without agent", async () => {
    const savedOpenAI = process.env.OPENAI_API_KEY;
    const savedAnthropic = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "";
    process.env.ANTHROPIC_API_KEY = "";

    try {
      await expect(
        searchIssues.handler(
          {
            organizationSlug: "test-org",
            naturalLanguageQuery: "unresolved issues",
            query: "is:unresolved",
            sort: "date",
            projectSlugOrId: null,
            regionUrl: null,
            limit: 10,
            includeExplanation: false,
          },
          mockContext,
        ),
      ).rejects.toThrow(ConfigurationError);
    } finally {
      process.env.OPENAI_API_KEY = savedOpenAI;
      if (savedAnthropic === undefined) {
        process.env.ANTHROPIC_API_KEY = "";
      } else {
        process.env.ANTHROPIC_API_KEY = savedAnthropic;
      }
    }
  });

  it("should handle project slug parameter", async () => {
    mockGenerateText.mockResolvedValue(mockAIResponse("", "date"));

    mswServer.use(
      http.get("*/api/0/projects/*/my-project/", () => {
        return HttpResponse.json({
          id: "789",
          slug: "my-project",
          name: "My Project",
        });
      }),
      http.get("*/api/0/projects/*/my-project/issues/*", () => {
        return HttpResponse.json([]);
      }),
    );

    const result = await searchIssues.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "all issues",
        query: "is:unresolved",
        sort: "date",
        projectSlugOrId: "my-project",
        regionUrl: null,
        limit: 10,
        includeExplanation: false,
      },
      mockContext,
    );

    expect(result).toContain("No issues found");
  });

  it("should handle numeric project ID", async () => {
    mockGenerateText.mockResolvedValue(mockAIResponse("", "date"));

    mswServer.use(
      http.get("*/api/0/projects/*/123456/issues/*", () => {
        return HttpResponse.json([]);
      }),
    );

    await searchIssues.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "all issues",
        query: "is:unresolved",
        sort: "date",
        projectSlugOrId: "123456",
        regionUrl: null,
        limit: 10,
        includeExplanation: false,
      },
      mockContext,
    );
  });

  it("should pass sort parameter to API", async () => {
    mockGenerateText.mockResolvedValue(mockAIResponse("", "freq"));

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/", ({ request }) => {
        const url = new URL(request.url);
        const sort = url.searchParams.get("sort");
        expect(sort).toBe("freq");
        return HttpResponse.json([]);
      }),
    );

    await searchIssues.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "most frequent errors",
        query: "is:unresolved",
        sort: "date",
        projectSlugOrId: null,
        regionUrl: null,
        limit: 10,
        includeExplanation: false,
      },
      mockContext,
    );
  });

  it("should default to date sort when agent returns null", async () => {
    mockGenerateText.mockResolvedValue(mockAIResponse("", null));

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/", ({ request }) => {
        const url = new URL(request.url);
        const sort = url.searchParams.get("sort");
        expect(sort).toBe("date");
        return HttpResponse.json([]);
      }),
    );

    await searchIssues.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "all issues",
        query: "is:unresolved",
        sort: "date",
        projectSlugOrId: null,
        regionUrl: null,
        limit: 10,
        includeExplanation: false,
      },
      mockContext,
    );
  });

  it("should respect custom limit parameter", async () => {
    mockGenerateText.mockResolvedValue(mockAIResponse());

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/", ({ request }) => {
        const url = new URL(request.url);
        const perPage = url.searchParams.get("per_page");
        expect(perPage).toBe("25");
        return HttpResponse.json([]);
      }),
    );

    await searchIssues.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "test",
        query: "is:unresolved",
        sort: "date",
        projectSlugOrId: null,
        regionUrl: null,
        limit: 25,
        includeExplanation: false,
      },
      mockContext,
    );
  });

  it("should include explanation when requested", async () => {
    mockGenerateText.mockResolvedValue(mockAIResponse("is:unresolved", "date"));

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/", () => {
        return HttpResponse.json([]);
      }),
    );

    const result = await searchIssues.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "unresolved issues",
        query: "is:unresolved",
        sort: "date",
        projectSlugOrId: null,
        regionUrl: null,
        limit: 10,
        includeExplanation: true,
      },
      mockContext,
    );

    expect(result).toContain("Query Translation");
    expect(result).toContain("Test query translation");
  });

  it("should handle empty results", async () => {
    mockGenerateText.mockResolvedValue(mockAIResponse());

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/", () => {
        return HttpResponse.json([]);
      }),
    );

    const result = await searchIssues.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "nonexistent issues",
        query: "is:unresolved",
        sort: "date",
        projectSlugOrId: null,
        regionUrl: null,
        limit: 10,
        includeExplanation: false,
      },
      mockContext,
    );

    expect(result).toContain("No issues found");
  });

  it("should pass agent query directly to API", async () => {
    mockGenerateText.mockResolvedValue(
      mockAIResponse("is:unresolved level:error", "date"),
    );

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/", ({ request }) => {
        const url = new URL(request.url);
        const query = url.searchParams.get("query");
        expect(query).toBe("is:unresolved level:error");
        return HttpResponse.json([]);
      }),
    );

    await searchIssues.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "unresolved errors",
        query: "is:unresolved",
        sort: "date",
        projectSlugOrId: null,
        regionUrl: null,
        limit: 10,
        includeExplanation: false,
      },
      mockContext,
    );
  });

  it("should handle all sort options", async () => {
    const sortOptions: Array<"date" | "freq" | "new" | "user"> = [
      "date",
      "freq",
      "new",
      "user",
    ];

    for (const sortOption of sortOptions) {
      mockGenerateText.mockResolvedValue(mockAIResponse("", sortOption));

      mswServer.use(
        http.get("*/api/0/organizations/*/issues/", ({ request }) => {
          const url = new URL(request.url);
          const sort = url.searchParams.get("sort");
          expect(sort).toBe(sortOption);
          return HttpResponse.json([]);
        }),
      );

      await searchIssues.handler(
        {
          organizationSlug: "test-org",
          naturalLanguageQuery: "test",
          query: "is:unresolved",
          sort: "date",
          projectSlugOrId: null,
          regionUrl: null,
          limit: 10,
          includeExplanation: false,
        },
        mockContext,
      );
    }
  });

  it("should format issues with proper markdown", async () => {
    mockGenerateText.mockResolvedValue(mockAIResponse("", "date"));

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/", () => {
        return HttpResponse.json([
          {
            id: "123",
            shortId: "PROJ-123",
            title: "Test Error",
            status: "unresolved",
            count: "100",
            userCount: 50,
            level: "error",
            firstSeen: "2025-01-15T10:00:00Z",
            lastSeen: "2025-01-15T12:00:00Z",
            permalink: "https://sentry.io/issues/123/",
            project: {
              id: "456",
              slug: "test-project",
              name: "Test Project",
            },
            culprit: "test.function",
          },
        ]);
      }),
    );

    const result = await searchIssues.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "all issues",
        query: "is:unresolved",
        sort: "date",
        projectSlugOrId: null,
        regionUrl: null,
        limit: 10,
        includeExplanation: false,
      },
      mockContext,
    );

    expect(result).toContain("# Search Results");
    expect(result).toContain("PROJ-123");
    expect(result).toContain("Test Error");
    expect(result).toContain("unresolved");
  });

  it("should validate project slug format", async () => {
    await expect(
      searchIssues.handler(
        {
          organizationSlug: "test-org",
          naturalLanguageQuery: "test",
          query: "is:unresolved",
          sort: "date",
          projectSlugOrId: "invalid@slug",
          regionUrl: null,
          limit: 10,
          includeExplanation: false,
        },
        mockContext,
      ),
    ).rejects.toThrow();
  });

  it("should handle API errors gracefully", async () => {
    mockGenerateText.mockResolvedValue(mockAIResponse());

    mswServer.use(
      http.get("*/api/0/organizations/*/issues/", () => {
        return HttpResponse.json(
          { detail: "Organization not found" },
          { status: 404 },
        );
      }),
    );

    await expect(
      searchIssues.handler(
        {
          organizationSlug: "nonexistent-org",
          naturalLanguageQuery: "test",
          query: "is:unresolved",
          sort: "date",
          projectSlugOrId: null,
          regionUrl: null,
          limit: 10,
          includeExplanation: false,
        },
        mockContext,
      ),
    ).rejects.toThrow();
  });
});
