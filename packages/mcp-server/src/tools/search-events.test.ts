import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import searchEvents from "./search-events.js";
import { generateText } from "ai";

// Mock the AI SDK
vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn(() => "mocked-model"),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(() => Promise.resolve({ text: "mocked query" })),
}));

describe("search_events", () => {
  const mockGenerateText = vi.mocked(generateText);

  beforeEach(() => {
    vi.clearAllMocks();
    // Set a mock API key for all tests since we're mocking the AI SDK
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("translates semantic query and returns results", async () => {
    // Mock the AI response
    mockGenerateText.mockResolvedValueOnce({
      text: 'message:"timeout" AND level:error',
    } as any);

    // Mock the tags API response
    mswServer.use(
      http.get("*/api/0/organizations/test-org/tags/", () =>
        HttpResponse.json([
          { key: "custom.tag", name: "Custom Tag", totalValues: 100 },
        ]),
      ),
    );

    // Mock the events API response
    mswServer.use(
      http.get("*/api/0/organizations/test-org/events/", () =>
        HttpResponse.json({
          data: [
            {
              title: "Database connection timeout",
              culprit: "db.connect",
              "event.type": "error",
              issue: "TEST-123",
              level: "error",
              project: "backend",
              "last_seen()": "2024-01-15T10:30:00Z",
              "count()": 42,
            },
            {
              title: "Redis timeout error",
              culprit: "cache.get",
              "event.type": "error",
              issue: "TEST-124",
              level: "error",
              project: "backend",
              "last_seen()": "2024-01-15T10:25:00Z",
              "count()": 15,
            },
          ],
        }),
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "database timeouts in the last hour",
        includeExplanation: true,
        limit: 10,
        projectSlug: undefined,
        regionUrl: undefined,
      },
      {
        accessToken: "test-token",
        userId: "1",
        organizationSlug: null,
      },
    );

    // Verify the AI was called with the right prompt
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "mocked-model",
        prompt: "database timeouts in the last hour",
        temperature: 0.1,
        system: expect.stringContaining("You are a Sentry query translator"),
      }),
    );

    // Check the output
    expect(result).toMatchInlineSnapshot(`
        "# Search Results for "database timeouts in the last hour"

        ## Query Translation
        Natural language: "database timeouts in the last hour"
        Sentry query: \`message:"timeout" AND level:error\`

        Found 2 events:

        ## Database connection timeout

        **Type**: Error
        **Issue ID**: TEST-123
        **URL**: https://test-org.sentry.io/issues/TEST-123
        **Project**: backend
        **Level**: error
        **Last Seen**: 2024-01-15T10:30:00Z
        **Occurrences**: 42
        **Location**: db.connect

        ## Redis timeout error

        **Type**: Error
        **Issue ID**: TEST-124
        **URL**: https://test-org.sentry.io/issues/TEST-124
        **Project**: backend
        **Level**: error
        **Last Seen**: 2024-01-15T10:25:00Z
        **Occurrences**: 15
        **Location**: cache.get

        ## Next Steps

        - Get more details about a specific issue: \`get_issue_details(organizationSlug, issueId)\`
        - Analyze an issue with AI: \`analyze_issue_with_seer(organizationSlug, issueId)\`
        - Update issue status: \`update_issue(organizationSlug, issueId, status)\`
        "
      `);
  });

  it("filters by project when specified", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "transaction.duration:>5000",
    } as any);

    mswServer.use(
      http.get("*/api/0/organizations/test-org/tags/", () =>
        HttpResponse.json([]),
      ),
      http.get("*/api/0/organizations/test-org/events/", ({ request }) => {
        const url = new URL(request.url);
        const query = url.searchParams.get("query");
        const project = url.searchParams.get("project");
        expect(query).toBe("transaction.duration:>5000");
        expect(project).toBe("frontend");

        return HttpResponse.json({
          data: [
            {
              title: "/api/users",
              "event.type": "transaction",
              project: "frontend",
              "last_seen()": "2024-01-15T10:30:00Z",
              "count()": 5,
            },
          ],
        } as any);
      }),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "slow API calls",
        projectSlug: "frontend",
        limit: 10,
        includeExplanation: false,
        regionUrl: undefined,
      },
      {
        accessToken: "test-token",
        userId: "1",
        organizationSlug: null,
      },
    );

    expect(result).toContain("Found 1 event:");
    expect(result).toContain("/api/users");
    expect(result).toContain("**Type**: Transaction");
  });

  it("handles empty results gracefully", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'message:"nonexistent error"',
    } as any);

    mswServer.use(
      http.get("*/api/0/organizations/test-org/tags/", () =>
        HttpResponse.json([]),
      ),
      http.get("*/api/0/organizations/test-org/events/", () =>
        HttpResponse.json({ data: [] }),
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "errors that don't exist",
        limit: 10,
        includeExplanation: false,
        projectSlug: undefined,
        regionUrl: undefined,
      },
      {
        accessToken: "test-token",
        userId: "1",
        organizationSlug: null,
      },
    );

    expect(result).toMatchInlineSnapshot(`
        "# Search Results for "errors that don't exist"

        No results found.

        Try being more specific or using different terms in your search.
        "
      `);
  });

  it("handles API errors gracefully", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "level:error",
    } as any);

    mswServer.use(
      http.get("*/api/0/organizations/test-org/tags/", () =>
        HttpResponse.json([]),
      ),
      http.get("*/api/0/organizations/test-org/events/", () =>
        HttpResponse.json({ detail: "Rate limit exceeded" }, { status: 429 }),
      ),
    );

    await expect(
      searchEvents.handler(
        {
          organizationSlug: "test-org",
          naturalLanguageQuery: "recent errors",
          limit: 10,
          includeExplanation: false,
          projectSlug: undefined,
          regionUrl: undefined,
        },
        {
          accessToken: "test-token",
          userId: "1",
          organizationSlug: null,
        },
      ),
    ).rejects.toThrow();
  });

  it("includes custom tags in query translation", async () => {
    mswServer.use(
      http.get("*/api/0/organizations/test-org/tags/", () =>
        HttpResponse.json([
          { key: "customer.tier", name: "Customer Tier", totalValues: 50 },
          { key: "feature.flag", name: "Feature Flag", totalValues: 75 },
        ]),
      ),
    );

    mockGenerateText.mockResolvedValueOnce({
      text: 'customer.tier:"premium" AND level:error',
    } as any);

    mswServer.use(
      http.get("*/api/0/organizations/test-org/events/", () =>
        HttpResponse.json({ data: [] }),
      ),
    );

    await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "errors from premium customers",
        limit: 10,
        includeExplanation: false,
        projectSlug: undefined,
        regionUrl: undefined,
      },
      {
        accessToken: "test-token",
        userId: "1",
        organizationSlug: null,
      },
    );

    // Verify custom tags were included in the system prompt
    expect(mockGenerateText).toHaveBeenCalled();
    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.system).toContain("customer.tier: Customer Tier");
    expect(callArgs.system).toContain("feature.flag: Feature Flag");
  });

  it("respects the limit parameter", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "level:error",
    } as any);

    mswServer.use(
      http.get("*/api/0/organizations/test-org/tags/", () =>
        HttpResponse.json([]),
      ),
      http.get("*/api/0/organizations/test-org/events/", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("per_page")).toBe("5");

        return HttpResponse.json({ data: [] });
      }),
    );

    await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "errors",
        limit: 5,
        includeExplanation: false,
        projectSlug: undefined,
        regionUrl: undefined,
      },
      {
        accessToken: "test-token",
        userId: "1",
        organizationSlug: null,
      },
    );
  });
});
