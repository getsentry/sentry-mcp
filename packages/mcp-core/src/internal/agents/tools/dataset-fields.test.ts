import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import {
  discoverDatasetFields,
  getFieldExamples,
  getCommonPatterns,
} from "./dataset-fields";
import { SentryApiService } from "../../../api-client";

// Test the core logic functions directly without AI SDK complexity

describe("dataset-fields agent tool", () => {
  let apiService: SentryApiService;

  beforeEach(() => {
    vi.clearAllMocks();
    apiService = new SentryApiService({
      accessToken: "test-token",
    });
  });

  describe("discoverDatasetFields", () => {
    it("should discover fields for search_issues dataset", async () => {
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

      const result = await discoverDatasetFields(
        apiService,
        "sentry-mcp-evals",
        "search_issues",
        { projectId: "4509062593708032" },
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

    it("should discover fields for events dataset (examples always included)", async () => {
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

      const result = await discoverDatasetFields(
        apiService,
        "sentry-mcp-evals",
        "events",
        { projectId: "4509062593708032" },
      );

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
        discoverDatasetFields(apiService, "sentry-mcp-evals", "errors"),
      ).rejects.toThrow();
    });

    it("should provide appropriate examples for each dataset type", async () => {
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

      const issuesResult = await discoverDatasetFields(
        apiService,
        "sentry-mcp-evals",
        "search_issues",
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

      const eventsResult = await discoverDatasetFields(
        apiService,
        "sentry-mcp-evals",
        "events",
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
      // Mock minimal API response
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry-mcp-evals/tags/",
          () => HttpResponse.json([]),
        ),
      );

      // Test patterns are returned correctly for each dataset type
      const issuesResult = await discoverDatasetFields(
        apiService,
        "sentry-mcp-evals",
        "search_issues",
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

      const eventsResult = await discoverDatasetFields(
        apiService,
        "sentry-mcp-evals",
        "events",
      );
      expect(eventsResult.commonPatterns).toEqual(
        expect.arrayContaining([
          { pattern: "level:error", description: "Error events" },
          { pattern: "has:http.method", description: "HTTP requests" },
        ]),
      );
    });
  });

  describe("getFieldExamples", () => {
    it("should return examples for search_issues fields", () => {
      expect(getFieldExamples("assignedOrSuggested", "search_issues")).toEqual([
        "email@example.com",
        "team-slug",
        "me",
      ]);
      expect(getFieldExamples("is", "search_issues")).toEqual([
        "unresolved",
        "resolved",
        "ignored",
      ]);
    });

    it("should return examples for events fields", () => {
      expect(getFieldExamples("http.method", "events")).toEqual([
        "GET",
        "POST",
        "PUT",
        "DELETE",
      ]);
      expect(getFieldExamples("db.system", "events")).toEqual([
        "postgresql",
        "mysql",
        "redis",
      ]);
    });

    it("should return common examples for unknown fields", () => {
      expect(getFieldExamples("level", "search_issues")).toEqual([
        "error",
        "warning",
        "info",
        "debug",
        "fatal",
      ]);
      expect(getFieldExamples("unknown", "search_issues")).toBeUndefined();
    });
  });

  describe("getCommonPatterns", () => {
    it("should return patterns for search_issues", () => {
      const patterns = getCommonPatterns("search_issues");
      expect(patterns).toContainEqual({
        pattern: "is:unresolved",
        description: "Open issues",
      });
      expect(patterns).toContainEqual({
        pattern: "firstSeen:-24h",
        description: "New issues from last 24 hours",
      });
    });

    it("should return patterns for events", () => {
      const patterns = getCommonPatterns("events");
      expect(patterns).toContainEqual({
        pattern: "level:error",
        description: "Error events",
      });
      expect(patterns).toContainEqual({
        pattern: "has:http.method",
        description: "HTTP requests",
      });
    });

    it("should return empty array for unknown datasets", () => {
      const patterns = getCommonPatterns("unknown");
      expect(patterns).toEqual([]);
    });
  });
});
