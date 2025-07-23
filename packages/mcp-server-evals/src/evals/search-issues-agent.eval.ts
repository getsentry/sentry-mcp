import { describe, it, expect, vi, beforeEach } from "vitest";
import { translateQuery } from "@sentry/mcp-server/dist/tools/search-issues/agent";
import type { SentryApiService } from "@sentry/mcp-server";

// Mock the OpenAI API key
vi.stubEnv("OPENAI_API_KEY", "test-key");

describe("search-issues agent", () => {
  let mockApiService: SentryApiService;

  beforeEach(() => {
    // Create mock API service
    mockApiService = {
      listTags: vi.fn().mockResolvedValue([
        { key: "is", name: "Status", totalValues: 3 },
        { key: "level", name: "Level", totalValues: 5 },
        { key: "assignedOrSuggested", name: "Assigned", totalValues: 100 },
        { key: "firstSeen", name: "First Seen", totalValues: 1000 },
        { key: "userCount", name: "Users Affected", totalValues: 500 },
        { key: "environment", name: "Environment", totalValues: 3 },
        { key: "release", name: "Release", totalValues: 50 },
      ]),
      getAuthenticatedUser: vi.fn().mockResolvedValue({
        id: "12345",
        email: "test@example.com",
        name: "Test User",
      }),
    } as unknown as SentryApiService;
  });

  it("should translate 'critical production errors' query", async () => {
    const result = await translateQuery(
      {
        naturalLanguageQuery:
          "critical production errors affecting more than 100 users",
        organizationSlug: "test-org",
      },
      mockApiService,
    );

    expect(result.query).toContain("level:error");
    expect(result.query).toContain("environment:production");
    expect(result.query).toContain("userCount:>100");
  });

  it("should translate 'unresolved issues' query", async () => {
    const result = await translateQuery(
      {
        naturalLanguageQuery: "unresolved issues",
        organizationSlug: "test-org",
      },
      mockApiService,
    );

    expect(result.query).toContain("is:unresolved");
  });

  it("should translate 'issues assigned to me' query", async () => {
    const result = await translateQuery(
      {
        naturalLanguageQuery: "issues assigned to me",
        organizationSlug: "test-org",
      },
      mockApiService,
    );

    // Should call getAuthenticatedUser to resolve 'me'
    expect(mockApiService.getAuthenticatedUser).toHaveBeenCalled();
    expect(result.query).toMatch(
      /assignedOrSuggested:(test@example\.com|12345)/,
    );
  });

  it("should translate 'new issues from last 24 hours' query", async () => {
    const result = await translateQuery(
      {
        naturalLanguageQuery: "new issues from the last 24 hours",
        organizationSlug: "test-org",
      },
      mockApiService,
    );

    expect(result.query).toContain("firstSeen:-24h");
  });

  it("should handle database errors query", async () => {
    const result = await translateQuery(
      {
        naturalLanguageQuery: "database connection errors",
        organizationSlug: "test-org",
      },
      mockApiService,
    );

    expect(result.query.toLowerCase()).toMatch(/database|db/);
    expect(result.query.toLowerCase()).toMatch(/connection|error/);
  });

  it("should handle high priority unhandled issues", async () => {
    const result = await translateQuery(
      {
        naturalLanguageQuery: "high priority issues that are unhandled",
        organizationSlug: "test-org",
      },
      mockApiService,
    );

    // The query should contain relevant filters
    expect(result.query).toBeTruthy();
    // Should not contain SQL syntax
    expect(result.query).not.toContain("SELECT");
    expect(result.query).not.toContain("FROM");
  });

  it("should provide sort order when appropriate", async () => {
    const result = await translateQuery(
      {
        naturalLanguageQuery: "most frequent errors today",
        organizationSlug: "test-org",
      },
      mockApiService,
    );

    expect(result.sort).toBe("freq");
  });

  it("should call discoverDatasetFields tool when needed", async () => {
    const result = await translateQuery(
      {
        naturalLanguageQuery: "errors with custom tags",
        organizationSlug: "test-org",
      },
      mockApiService,
    );

    // The agent should have called listTags to discover available fields
    expect(mockApiService.listTags).toHaveBeenCalledWith({
      organizationSlug: "test-org",
      dataset: "search_issues",
      project: undefined,
      statsPeriod: "14d",
    });

    expect(result.query).toBeTruthy();
  });

  it("should handle project-specific queries", async () => {
    const result = await translateQuery(
      {
        naturalLanguageQuery: "errors in the frontend",
        organizationSlug: "test-org",
        projectSlugOrId: "frontend",
        projectId: "123",
      },
      mockApiService,
    );

    // Should pass project ID to field discovery
    expect(mockApiService.listTags).toHaveBeenCalledWith({
      organizationSlug: "test-org",
      dataset: "search_issues",
      project: "123",
      statsPeriod: "14d",
    });

    expect(result.query).toBeTruthy();
  });

  it("should not fail due to schema validation issues", async () => {
    // This is the key test - ensuring our fix for the includeExamples field works
    const promise = translateQuery(
      {
        naturalLanguageQuery: "any query",
        organizationSlug: "test-org",
      },
      mockApiService,
    );

    // Should not throw schema validation errors
    await expect(promise).resolves.toBeTruthy();
  });
});
