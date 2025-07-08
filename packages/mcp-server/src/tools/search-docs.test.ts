import { describe, it, expect, vi } from "vitest";
import searchDocs from "./search-docs.js";

describe("search_docs", () => {
  // Note: Query validation (empty, too short, too long) is now handled by Zod schema
  // These validation tests are no longer needed as they test framework behavior, not our tool logic

  it("returns results from the API", async () => {
    const result = await searchDocs.handler(
      {
        query: "How do I configure rate limiting?",
        maxResults: 5,
        guide: undefined,
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
        host: "https://mcp.sentry.dev",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Documentation Search Results

      **Query**: "How do I configure rate limiting?"

      Found 2 matches

      These are just snippets. Use \`get_doc(path='...')\` to fetch the full content.

      ## 1. https://docs.sentry.io/product/rate-limiting

      **Path**: product/rate-limiting.md
      **Relevance**: 95.0%

      **Matching Context**
      > Learn how to configure rate limiting in Sentry to prevent quota exhaustion and control event ingestion.

      ## 2. https://docs.sentry.io/product/accounts/quotas/spike-protection

      **Path**: product/accounts/quotas/spike-protection.md
      **Relevance**: 87.0%

      **Matching Context**
      > Spike protection helps prevent unexpected spikes in event volume from consuming your quota.

      "
    `);
  });

  it("handles API errors", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ error: "Internal server error" }),
    } as Response);

    await expect(
      searchDocs.handler(
        {
          query: "test query",
          maxResults: undefined,
          guide: undefined,
        },
        {
          accessToken: "access-token",
          userId: "1",
          organizationSlug: null,
        },
      ),
    ).rejects.toThrow();
  });

  it("handles timeout errors", async () => {
    // Mock fetch to simulate a timeout by throwing an AbortError
    vi.spyOn(global, "fetch").mockImplementationOnce(() => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    });

    await expect(
      searchDocs.handler(
        {
          query: "test query",
          maxResults: undefined,
          guide: undefined,
        },
        {
          accessToken: "access-token",
          userId: "1",
          organizationSlug: null,
        },
      ),
    ).rejects.toThrow("Request timeout after 15000ms");
  });

  it("includes platform in output and request", async () => {
    const mockFetch = vi.spyOn(global, "fetch");

    const result = await searchDocs.handler(
      {
        query: "test query",
        maxResults: 5,
        guide: "javascript/nextjs",
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
        host: "https://mcp.sentry.dev",
      },
    );

    // Check that platform is included in the output
    expect(result).toContain("**Guide**: javascript/nextjs");

    // Check that platform is included in the request
    expect(mockFetch).toHaveBeenCalledWith(
      "https://mcp.sentry.dev/api/search",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "test query",
          maxResults: 5,
          guide: "javascript/nextjs",
        }),
      }),
    );
  });
});
