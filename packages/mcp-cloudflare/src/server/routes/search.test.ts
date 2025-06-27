import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import searchRoute from "./search";
import type { Env } from "../types";
import type { Ai, AutoRagSearchResponse } from "@cloudflare/workers-types";

// Create mock AutoRAG instance
interface MockAutoRAG {
  search: ReturnType<typeof vi.fn>;
}

// Create mock AI binding that matches Cloudflare's Ai interface
const mockAutorag: MockAutoRAG = {
  search: vi.fn(),
};

const mockAIBinding = {
  autorag: vi.fn(() => mockAutorag),
} as unknown as Ai;

// Create test app with mocked environment
function createTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/search", searchRoute);

  return app;
}

describe("search route", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();

    // Setup default mock behavior
    const defaultResponse: AutoRagSearchResponse = {
      object: "vector_store.search_results.page",
      search_query: "test query",
      data: [
        {
          file_id: "40d26845-75f9-478c-ab2e-30d30b1b049b",
          filename: "platforms/javascript/guides/react.md",
          score: 0.95,
          attributes: {
            timestamp: 1750952340000,
            folder: "platforms/javascript/guides/",
            filename: "react.md",
          },
          content: [
            {
              type: "text",
              text: "This is test documentation content about React setup and configuration.",
            },
          ],
        },
      ],
      has_more: false,
      next_page: null,
    };
    mockAutorag.search.mockResolvedValue(defaultResponse);
  });

  describe("POST /api/search", () => {
    it("should return 400 when query is missing", async () => {
      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({}),
        },
        {
          AI: mockAIBinding,
        },
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toHaveProperty("error", "Invalid request");
      expect(json).toHaveProperty("details");
    });

    it("should return 400 when query is empty", async () => {
      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "" }),
        },
        {
          AI: mockAIBinding,
        },
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toHaveProperty("error", "Invalid request");
    });

    it("should return 400 when maxResults is out of range", async () => {
      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "test", maxResults: 15 }),
        },
        {
          AI: mockAIBinding,
        },
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toHaveProperty("error", "Invalid request");
    });

    it("should return 503 when AI binding is not available", async () => {
      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "test" }),
        },
        {
          AI: null as unknown as Ai,
        },
      );

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json).toEqual({
        error: "AI service not available",
        name: "AI_SERVICE_UNAVAILABLE",
      });
    });

    it("should successfully search with default parameters", async () => {
      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "rate limiting" }),
        },
        {
          AI: mockAIBinding,
        },
      );

      expect(res.status).toBe(200);
      const json = await res.json();

      expect(mockAIBinding.autorag).toHaveBeenCalledWith("sentry-docs");
      expect(mockAutorag.search).toHaveBeenCalledWith({
        query: "rate limiting",
        max_num_results: 10,
      });

      expect(json).toMatchObject({
        query: "rate limiting",
        results: [
          {
            id: "platforms/javascript/guides/react.md",
            url: "https://docs.sentry.io/platforms/javascript/guides/react",
            snippet:
              "This is test documentation content about React setup and configuration.",
            relevance: 0.95,
          },
        ],
      });
    });

    it("should handle custom maxResults parameter", async () => {
      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "error handling", maxResults: 5 }),
        },
        {
          AI: mockAIBinding,
        },
      );

      expect(res.status).toBe(200);
      expect(mockAutorag.search).toHaveBeenCalledWith({
        query: "error handling",
        max_num_results: 5,
      });
    });

    it("should handle empty search results", async () => {
      mockAutorag.search.mockResolvedValue({
        object: "vector_store.search_results.page",
        search_query: "test query",
        data: [],
        has_more: false,
        next_page: null,
      });

      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "nonexistent topic" }),
        },
        {
          AI: mockAIBinding,
        },
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toMatchObject({
        query: "nonexistent topic",
        results: [],
      });
    });

    it("should handle AutoRAG search errors gracefully", async () => {
      mockAutorag.search.mockRejectedValue(new Error("AutoRAG API error"));

      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "test" }),
        },
        {
          AI: mockAIBinding,
        },
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toMatchObject({
        query: "test",
        results: [],
        error: "Failed to search documentation. Please try again later.",
      });
    });

    it("should extract documentation paths correctly", async () => {
      mockAutorag.search.mockResolvedValue({
        object: "vector_store.search_results.page",
        search_query: "test query",
        data: [
          {
            file_id: "id-1",
            filename: "platforms/javascript/index.md",
            score: 0.9,
            attributes: {
              timestamp: 1750952340000,
              folder: "platforms/javascript/",
              filename: "index.md",
            },
            content: [
              {
                type: "text",
                text: "Content 1",
              },
            ],
          },
          {
            file_id: "id-2",
            filename: "product/issues.md",
            score: 0.8,
            attributes: {
              timestamp: 1750952340000,
              folder: "product/",
              filename: "issues.md",
            },
            content: [
              {
                type: "text",
                text: "Content 2",
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      });

      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "test" }),
        },
        {
          AI: mockAIBinding,
        },
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        results: Array<{ id: string; url: string }>;
      };
      expect(json.results[0]).toMatchObject({
        id: "platforms/javascript/index.md",
        url: "https://docs.sentry.io/platforms/javascript/index",
      });
      expect(json.results[1]).toMatchObject({
        id: "product/issues.md",
        url: "https://docs.sentry.io/product/issues",
      });
    });

    it("should handle index.md files correctly", async () => {
      mockAutorag.search.mockResolvedValue({
        object: "vector_store.search_results.page",
        search_query: "test query",
        data: [
          {
            file_id: "root-id",
            filename: "index.md",
            score: 0.9,
            attributes: {
              timestamp: 1750952340000,
              folder: "",
              filename: "index.md",
            },
            content: [
              {
                type: "text",
                text: "Root documentation content",
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      });

      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "test" }),
        },
        {
          AI: mockAIBinding,
        },
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        results: Array<{ id: string; url: string }>;
      };
      expect(json.results[0].id).toBe("index.md");
      expect(json.results[0].url).toBe("https://docs.sentry.io/index");
    });

    it("should handle missing metadata fields", async () => {
      mockAutorag.search.mockResolvedValue({
        object: "vector_store.search_results.page",
        search_query: "test query",
        data: [
          {
            // Missing filename, should use index.md as fallback
            file_id: "some-id",
            score: 0.5,
            attributes: {},
            content: [
              {
                type: "text",
                text: "Content without metadata",
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      });

      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "test" }),
        },
        {
          AI: mockAIBinding,
        },
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        results: Array<{ id: string; url: string }>;
      };
      expect(json.results[0]).toMatchObject({
        id: "",
        url: "",
        snippet: "Content without metadata",
        relevance: 0.5,
      });
    });

    it("should handle unexpected response structure", async () => {
      mockAutorag.search.mockResolvedValue({
        // Missing expected fields
        unexpected: "response",
      });

      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "test" }),
        },
        {
          AI: mockAIBinding,
        },
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toMatchObject({
        query: "test",
        results: [],
      });
    });
  });

  describe("rate limiting", () => {
    it("should allow requests when rate limiter is not configured", async () => {
      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "test query" }),
        },
        {
          AI: mockAIBinding,
          // No SEARCH_RATE_LIMITER binding
        },
      );

      expect(res.status).toBe(200);
    });

    it("should allow requests when rate limit is not exceeded", async () => {
      const mockRateLimiter = {
        limit: vi.fn().mockResolvedValue({ success: true }),
      };

      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "test query" }),
        },
        {
          AI: mockAIBinding,
          SEARCH_RATE_LIMITER: mockRateLimiter,
        },
      );

      expect(res.status).toBe(200);
      expect(mockRateLimiter.limit).toHaveBeenCalledWith({
        key: expect.stringMatching(/^search:ip:[a-f0-9]{16}$/),
      });
    });

    it("should reject requests when rate limit is exceeded", async () => {
      const mockRateLimiter = {
        limit: vi.fn().mockResolvedValue({ success: false }),
      };

      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "test query" }),
        },
        {
          AI: mockAIBinding,
          SEARCH_RATE_LIMITER: mockRateLimiter,
        },
      );

      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json).toMatchObject({
        error:
          "Rate limit exceeded. You can perform up to 20 documentation searches per minute. Please wait before searching again.",
        name: "RATE_LIMIT_EXCEEDED",
      });
    });

    it("should handle rate limiter errors gracefully", async () => {
      const mockRateLimiter = {
        limit: vi
          .fn()
          .mockRejectedValue(new Error("Rate limiter connection failed")),
      };

      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "test query" }),
        },
        {
          AI: mockAIBinding,
          SEARCH_RATE_LIMITER: mockRateLimiter,
        },
      );

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json).toMatchObject({
        error: "There was an error communicating with the rate limiter.",
        name: "RATE_LIMITER_ERROR",
      });
    });

    it("should use different rate limit keys for different IPs", async () => {
      const mockRateLimiter = {
        limit: vi.fn().mockResolvedValue({ success: true }),
      };

      // First request from IP 192.0.2.1
      await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "test query" }),
        },
        {
          AI: mockAIBinding,
          SEARCH_RATE_LIMITER: mockRateLimiter,
        },
      );

      const firstKey = mockRateLimiter.limit.mock.calls[0][0].key;

      // Second request from IP 192.0.2.2
      await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.2",
          },
          body: JSON.stringify({ query: "test query" }),
        },
        {
          AI: mockAIBinding,
          SEARCH_RATE_LIMITER: mockRateLimiter,
        },
      );

      const secondKey = mockRateLimiter.limit.mock.calls[1][0].key;

      expect(firstKey).not.toBe(secondKey);
      expect(firstKey).toMatch(/^search:ip:[a-f0-9]{16}$/);
      expect(secondKey).toMatch(/^search:ip:[a-f0-9]{16}$/);
    });
  });

  describe("configurable index name", () => {
    it("should use default index name when AUTORAG_INDEX_NAME is not set", async () => {
      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "test query" }),
        },
        {
          AI: mockAIBinding,
          // No AUTORAG_INDEX_NAME environment variable
        },
      );

      expect(res.status).toBe(200);
      expect(mockAIBinding.autorag).toHaveBeenCalledWith("sentry-docs");
    });

    it("should use custom index name when AUTORAG_INDEX_NAME is set", async () => {
      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "test query" }),
        },
        {
          AI: mockAIBinding,
          AUTORAG_INDEX_NAME: "custom-docs-index",
        },
      );

      expect(res.status).toBe(200);
      expect(mockAIBinding.autorag).toHaveBeenCalledWith("custom-docs-index");
    });

    it("should use default index name when AUTORAG_INDEX_NAME is empty", async () => {
      const res = await app.request(
        "/api/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.1",
          },
          body: JSON.stringify({ query: "test query" }),
        },
        {
          AI: mockAIBinding,
          AUTORAG_INDEX_NAME: "",
        },
      );

      expect(res.status).toBe(200);
      expect(mockAIBinding.autorag).toHaveBeenCalledWith("sentry-docs");
    });
  });
});
