import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import { createDatasetFieldsTool } from "./dataset-fields";
import { SentryApiService } from "../api-client";
import type { ToolExecutionOptions } from "ai";

// No need to mock AI SDK - we're just testing the execute function logic

describe("dataset-fields agent tool", () => {
  let apiService: SentryApiService;
  let mockOptions: ToolExecutionOptions;

  beforeEach(() => {
    vi.clearAllMocks();
    apiService = new SentryApiService({
      accessToken: "test-token",
    });
    mockOptions = {
      toolCallId: "test-call-id",
      messages: [],
    };
  });

  describe("createDatasetFieldsTool", () => {
    it("should discover fields for search_issues dataset", async () => {
      const tool = createDatasetFieldsTool(
        apiService,
        "sentry-mcp-evals",
        "search_issues",
        "4509062593708032",
      );

      // Mock the tags API response for issues
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry-mcp-evals/tags/",
          ({ request }) => {
            const url = new URL(request.url);
            expect(url.searchParams.get("dataset")).toBe("search_issues");
            expect(url.searchParams.get("project")).toBe("4509062593708032");
            expect(url.searchParams.get("statsPeriod")).toBe("14d");

            return HttpResponse.json([
              {
                key: "level",
                name: "Level",
                totalValues: 5,
                topValues: [
                  { key: "error", name: "error", value: "error", count: 42 },
                ],
              },
              {
                key: "is",
                name: "Status",
                totalValues: 3,
                topValues: [
                  {
                    key: "unresolved",
                    name: "unresolved",
                    value: "unresolved",
                    count: 15,
                  },
                ],
              },
              {
                key: "sentry:user", // Should be filtered out
                name: "User (Internal)",
                totalValues: 10,
              },
            ]);
          },
        ),
      );

      const result = await tool.execute(
        { includeExamples: false },
        mockOptions,
      );

      expect(result.dataset).toBe("search_issues");
      expect(result.fields).toHaveLength(2); // sentry:user should be filtered out
      expect(result.fields[0].key).toBe("level");
      expect(result.fields[0].name).toBe("Level");
      expect(result.fields[0].totalValues).toBe(5);
      expect(result.fields[1].key).toBe("is");
      expect(result.commonPatterns).toContainEqual({
        pattern: "is:unresolved",
        description: "Open issues",
      });
    });

    it("should discover fields for events dataset with examples", async () => {
      const tool = createDatasetFieldsTool(
        apiService,
        "sentry-mcp-evals",
        "events",
        "4509062593708032",
      );

      // Mock the tags API response for events
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry-mcp-evals/tags/",
          ({ request }) => {
            const url = new URL(request.url);
            expect(url.searchParams.get("dataset")).toBe("events");

            return HttpResponse.json([
              {
                key: "http.method",
                name: "HTTP Method",
                totalValues: 4,
              },
              {
                key: "environment",
                name: "Environment",
                totalValues: 3,
              },
            ]);
          },
        ),
      );

      const result = await tool.execute({ includeExamples: true }, mockOptions);

      expect(result.dataset).toBe("events");
      expect(result.fields).toHaveLength(2);
      expect(result.fields[0].key).toBe("http.method");
      expect(result.fields[0].examples).toEqual([
        "GET",
        "POST",
        "PUT",
        "DELETE",
      ]);
      expect(result.fields[1].key).toBe("environment");
      expect(result.fields[1].examples).toEqual([
        "production",
        "staging",
        "development",
      ]);
      expect(result.commonPatterns).toContainEqual({
        pattern: "level:error",
        description: "Error events",
      });
    });

    it("should handle API errors gracefully", async () => {
      const tool = createDatasetFieldsTool(
        apiService,
        "sentry-mcp-evals",
        "errors",
      );

      // Mock API error
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry-mcp-evals/tags/",
          () =>
            HttpResponse.json(
              { detail: "Organization not found" },
              { status: 404 },
            ),
        ),
      );

      await expect(
        tool.execute({ includeExamples: false }, mockOptions),
      ).rejects.toThrow();
    });

    it("should provide appropriate examples for each dataset type", async () => {
      // Test search_issues examples
      const searchIssuesTool = createDatasetFieldsTool(
        apiService,
        "sentry-mcp-evals",
        "search_issues",
      );

      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry-mcp-evals/tags/",
          () =>
            HttpResponse.json([
              { key: "assignedOrSuggested", name: "Assigned", totalValues: 5 },
              { key: "is", name: "Status", totalValues: 3 },
            ]),
        ),
      );

      const issuesResult = await searchIssuesTool.execute(
        { includeExamples: true },
        mockOptions,
      );

      expect(issuesResult.fields[0].examples).toEqual([
        "email@example.com",
        "team-slug",
        "me",
      ]);
      expect(issuesResult.fields[1].examples).toEqual([
        "unresolved",
        "resolved",
        "ignored",
      ]);

      // Test events examples
      const eventsTool = createDatasetFieldsTool(
        apiService,
        "sentry-mcp-evals",
        "events",
      );

      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry-mcp-evals/tags/",
          () =>
            HttpResponse.json([
              { key: "http.method", name: "HTTP Method", totalValues: 4 },
              { key: "db.system", name: "Database System", totalValues: 3 },
            ]),
        ),
      );

      const eventsResult = await eventsTool.execute(
        { includeExamples: true },
        mockOptions,
      );

      expect(eventsResult.fields[0].examples).toEqual([
        "GET",
        "POST",
        "PUT",
        "DELETE",
      ]);
      expect(eventsResult.fields[1].examples).toEqual([
        "postgresql",
        "mysql",
        "redis",
      ]);
    });

    it("should provide correct common patterns for different datasets", async () => {
      const searchIssuesTool = createDatasetFieldsTool(
        apiService,
        "sentry-mcp-evals",
        "search_issues",
      );

      const eventsTool = createDatasetFieldsTool(
        apiService,
        "sentry-mcp-evals",
        "events",
      );

      // Mock minimal API response
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry-mcp-evals/tags/",
          () => HttpResponse.json([]),
        ),
      );

      // Test patterns are returned correctly for each dataset type
      const issuesResult = await searchIssuesTool.execute(
        { includeExamples: false },
        mockOptions,
      );
      expect(issuesResult.commonPatterns).toEqual(
        expect.arrayContaining([
          { pattern: "is:unresolved", description: "Open issues" },
          {
            pattern: "firstSeen:-24h",
            description: "New issues from last 24 hours",
          },
        ]),
      );

      const eventsResult = await eventsTool.execute(
        { includeExamples: false },
        mockOptions,
      );
      expect(eventsResult.commonPatterns).toEqual(
        expect.arrayContaining([
          { pattern: "level:error", description: "Error events" },
          { pattern: "has:http.method", description: "HTTP requests" },
        ]),
      );
    });
  });
});
