import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import searchIssues from "./search-issues";

describe("search_issues", () => {
  it.skip("integration test - should work with real OpenAI API", async () => {
    // This test is skipped by default but can be enabled for integration testing
    // Requires real OPENAI_API_KEY environment variable
    if (!process.env.OPENAI_API_KEY?.startsWith("sk-")) {
      return;
    }

    // Mock the Sentry API response
    mswServer.use(
      http.get("https://sentry.io/api/0/organizations/test-org/issues/", () =>
        HttpResponse.json([
          {
            id: "integration-test",
            shortId: "TEST-123",
            title: "Integration test issue",
            level: "error",
            status: "unresolved",
            firstSeen: "2024-01-15T10:30:00.000Z",
            lastSeen: "2024-01-15T15:45:00.000Z",
            userCount: 5,
            count: "12",
            permalink: "https://test-org.sentry.io/issues/integration-test/",
            project: {
              name: "test-project",
              slug: "test-project",
            },
          },
        ]),
      ),
    );

    const result = await searchIssues.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "recent error issues",
        limit: 5,
        includeExplanation: false,
      },
      {
        accessToken: "test-token",
        userId: "1",
        organizationSlug: null,
      },
    );

    expect(result).toContain("TEST-123");
    expect(result).toContain("Integration test issue");
  });
});
