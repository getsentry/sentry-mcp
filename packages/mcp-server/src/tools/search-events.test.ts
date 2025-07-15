import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import searchEvents from "./search-events.js";
import { generateObject } from "ai";

// Mock the AI SDK
vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn(() => "mocked-model"),
}));

vi.mock("ai", () => ({
  generateObject: vi.fn(() =>
    Promise.resolve({
      object: {
        query: "mocked query",
        fields: [
          "issue",
          "title",
          "project",
          "timestamp",
          "level",
          "message",
          "error.type",
          "culprit",
        ],
        sort: "-timestamp", // Added required sort parameter
        // error field is undefined by default (success case)
      },
    }),
  ),
}));

describe("search_events", () => {
  const mockGenerateObject = vi.mocked(generateObject);

  // Helper to create JSON response for AI mocks
  const mockAIResponse = (
    query: string,
    dataset: "errors" | "logs" | "spans" = "errors",
    errorMessage?: string,
  ) => {
    const fieldSets = {
      errors: [
        "issue",
        "title",
        "project",
        "timestamp",
        "level",
        "message",
        "error.type",
        "culprit",
      ],
      logs: ["timestamp", "project", "message", "severity", "trace"],
      spans: [
        "span.op",
        "span.description",
        "span.duration",
        "transaction",
        "timestamp",
        "project",
        "trace",
      ],
    };

    const sortParams = {
      errors: "-timestamp",
      logs: "-timestamp",
      spans: "-span.duration",
    };

    const object = errorMessage
      ? { error: errorMessage }
      : { query, fields: fieldSets[dataset], sort: sortParams[dataset] };

    return {
      object,
      finishReason: "stop" as const,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      warnings: [] as const,
      request: {},
      response: {
        id: "test-response-id",
        timestamp: new Date(),
        modelId: "gpt-4o",
      },
      experimental_providerMetadata: undefined,
      logprobs: undefined,
      get providerMetadata() {
        return this.response;
      },
      toJsonResponse: () => ({ object }),
    } as any;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Set a mock API key for all tests since we're mocking the AI SDK
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("translates semantic query and returns results", async () => {
    // Mock the AI response
    mockGenerateObject.mockResolvedValueOnce(
      mockAIResponse('message:"timeout" AND level:error', "spans"),
    );

    // Mock the trace-items attributes API response for both string and number types
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("itemType")).toBe("spans");
          const attributeType = url.searchParams.get("attributeType");
          expect(["string", "number"].includes(attributeType!)).toBe(true);

          if (attributeType === "string") {
            return HttpResponse.json([
              { key: "custom.tag", name: "Custom Tag" },
              { key: "span.op", name: "Span Operation" },
              { key: "transaction", name: "Transaction" },
            ]);
          }
          return HttpResponse.json([
            { key: "span.duration", name: "Span Duration" },
            { key: "custom.number", name: "Custom Number" },
          ]);
        },
      ),
    );

    // Mock the events API response with spans data
    mswServer.use(
      http.get("https://sentry.io/api/0/organizations/test-org/events/", () =>
        HttpResponse.json({
          data: [
            {
              id: "span1",
              "span.op": "db.query",
              "span.description": "SELECT * FROM users WHERE timeout",
              "span.duration": 5234,
              transaction: "/api/checkout",
              timestamp: "2024-01-15T10:30:00Z",
              project: "backend",
              trace: "abc123def456",
            },
            {
              id: "span2",
              "span.op": "cache.get",
              "span.description": "GET user:session:timeout",
              "span.duration": 1500,
              transaction: "/api/checkout",
              timestamp: "2024-01-15T10:25:00Z",
              project: "backend",
              trace: "xyz789ghi012",
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
        dataset: "spans",
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
    expect(mockGenerateObject).toHaveBeenCalledWith(
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

      ⚠️ **IMPORTANT**: Display these traces as a performance timeline with duration bars and hierarchical span relationships.

      ## Query Translation
      Natural language: "database timeouts in the last hour"
      Sentry query: \`message:"timeout" AND level:error\`

      **📊 View these results in Sentry**: https://test-org.sentry.io/explore/traces/?query=message%3A%22timeout%22+AND+level%3Aerror
      _Please share this link with the user to view the search results in their Sentry dashboard._

      Found 2 traces/spans:

      ## SELECT * FROM users WHERE timeout

      **span.op**: db.query
      **span.description**: SELECT * FROM users WHERE timeout
      **transaction**: /api/checkout
      **span.duration**: 5234ms
      **Trace ID**: abc123def456
      **Trace URL**: https://test-org.sentry.io/explore/traces/trace/abc123def456
      **project**: backend
      **timestamp**: 2024-01-15T10:30:00Z

      ## GET user:session:timeout

      **span.op**: cache.get
      **span.description**: GET user:session:timeout
      **transaction**: /api/checkout
      **span.duration**: 1500ms
      **Trace ID**: xyz789ghi012
      **Trace URL**: https://test-org.sentry.io/explore/traces/trace/xyz789ghi012
      **project**: backend
      **timestamp**: 2024-01-15T10:25:00Z

      ## Next Steps

      - View the full trace: Click on the Trace URL above
      - Search for related spans: Modify your query to be more specific
      - Export data: Use the Sentry web interface for advanced analysis
      "
    `);
  });

  it("filters by project when specified", async () => {
    mockGenerateObject.mockResolvedValueOnce(
      mockAIResponse("transaction.duration:>5000", "spans"),
    );

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("itemType")).toBe("spans");
          const attributeType = url.searchParams.get("attributeType");
          expect(["string", "number"].includes(attributeType!)).toBe(true);
          return HttpResponse.json([]);
        },
      ),
      // Mock the direct project lookup endpoint
      http.get("https://sentry.io/api/0/projects/test-org/frontend/", () =>
        HttpResponse.json({
          id: "123456",
          slug: "frontend",
          name: "Frontend App",
          platform: "javascript",
        }),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          const query = url.searchParams.get("query");
          const project = url.searchParams.get("project");
          expect(query).toBe("transaction.duration:>5000");
          expect(project).toBe("123456"); // Should be the numeric ID

          return HttpResponse.json({
            data: [
              {
                id: "span1",
                "span.op": "http.server",
                "span.description": "GET /api/users",
                "span.duration": 8500,
                transaction: "/api/users",
                timestamp: "2024-01-15T10:30:00Z",
                project: "frontend",
                trace: "def456abc123",
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "slow API calls",
        projectSlug: "frontend",
        limit: 10,
        dataset: "spans",
        includeExplanation: false,
        regionUrl: undefined,
      },
      {
        accessToken: "test-token",
        userId: "1",
        organizationSlug: null,
      },
    );

    expect(result).toContain("Found 1 trace/span:");
    expect(result).toContain("GET /api/users");
    expect(result).toContain("**span.op**: http.server");
    expect(result).toContain("**span.duration**: 8500ms");
    expect(result).toContain("**📊 View these results in Sentry**:");
    expect(result).toContain(
      "https://test-org.sentry.io/explore/traces/?query=transaction.duration%3A%3E5000&project=123456",
    );
    expect(result).toContain(
      "_Please share this link with the user to view the search results in their Sentry dashboard._",
    );
  });

  it("handles empty results gracefully", async () => {
    mockGenerateObject.mockResolvedValueOnce(
      mockAIResponse('message:"nonexistent error"', "spans"),
    );

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("itemType")).toBe("spans");
          const attributeType = url.searchParams.get("attributeType");
          expect(["string", "number"].includes(attributeType!)).toBe(true);
          return HttpResponse.json([]);
        },
      ),
      http.get("https://sentry.io/api/0/organizations/test-org/events/", () =>
        HttpResponse.json({ data: [] }),
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "errors that don't exist",
        limit: 10,
        dataset: "spans",
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

      ⚠️ **IMPORTANT**: Display these traces as a performance timeline with duration bars and hierarchical span relationships.

      **📊 View these results in Sentry**: https://test-org.sentry.io/explore/traces/?query=message%3A%22nonexistent+error%22
      _Please share this link with the user to view the search results in their Sentry dashboard._

      No results found.

      Try being more specific or using different terms in your search.
      "
    `);
  });

  it("handles API errors gracefully", async () => {
    mockGenerateObject.mockResolvedValueOnce(
      mockAIResponse("level:error", "spans"),
    );

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("itemType")).toBe("spans");
          const attributeType = url.searchParams.get("attributeType");
          expect(["string", "number"].includes(attributeType!)).toBe(true);
          return HttpResponse.json([]);
        },
      ),
      http.get("https://sentry.io/api/0/organizations/test-org/events/", () =>
        HttpResponse.json({ detail: "Rate limit exceeded" }, { status: 429 }),
      ),
    );

    await expect(
      searchEvents.handler(
        {
          organizationSlug: "test-org",
          naturalLanguageQuery: "recent errors",
          limit: 10,
          dataset: "spans",
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

  it("includes custom attributes in query translation", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("itemType")).toBe("spans");
          const attributeType = url.searchParams.get("attributeType");
          expect(["string", "number"].includes(attributeType!)).toBe(true);

          if (attributeType === "string") {
            return HttpResponse.json([
              { key: "customer.tier", name: "Customer Tier" },
              { key: "feature.flag", name: "Feature Flag" },
            ]);
          }
          return HttpResponse.json([
            { key: "custom.count", name: "Custom Count" },
          ]);
        },
      ),
    );

    mockGenerateObject.mockResolvedValueOnce(
      mockAIResponse('customer.tier:"premium" AND level:error', "spans"),
    );

    mswServer.use(
      http.get("https://sentry.io/api/0/organizations/test-org/events/", () =>
        HttpResponse.json({ data: [] }),
      ),
    );

    await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "errors from premium customers",
        limit: 10,
        dataset: "spans",
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

    // Verify custom attributes were included in the system prompt
    expect(mockGenerateObject).toHaveBeenCalled();
    const callArgs = mockGenerateObject.mock.calls[0][0];
    expect(callArgs.system).toContain("customer.tier: Customer Tier");
    expect(callArgs.system).toContain("feature.flag: Feature Flag");
  });

  it("defaults to errors dataset when not specified", async () => {
    mockGenerateObject.mockResolvedValueOnce(
      mockAIResponse('message:"connection refused"', "errors"),
    );

    mswServer.use(
      // Should use listTags for errors dataset by default
      http.get("https://sentry.io/api/0/organizations/test-org/tags/", () =>
        HttpResponse.json([
          { key: "environment", name: "Environment", totalValues: 3 },
        ]),
      ),
      http.get("https://sentry.io/api/0/organizations/test-org/events/", () =>
        HttpResponse.json({
          data: [
            {
              id: "error1",
              message: "Connection refused",
              level: "error",
              culprit: "network.connect",
              title: "Connection refused",
              timestamp: "2024-01-15T10:30:00Z",
              project: "backend",
            },
          ],
        }),
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "connection refused errors",
        dataset: "errors" as const,
        limit: 10,
        includeExplanation: false,
      },
      {
        accessToken: "test-token",
        userId: "1",
        organizationSlug: null,
      },
    );

    expect(result).toContain("Found 1 error:");
    expect(result).toContain("Connection refused");
    expect(result).toContain("**level**: error");
  });

  it("handles errors dataset with listTags", async () => {
    mockGenerateObject.mockResolvedValueOnce(
      mockAIResponse('level:error AND message:"null pointer"', "errors"),
    );

    mswServer.use(
      // For errors dataset, it uses listTags instead of trace-items attributes
      http.get("https://sentry.io/api/0/organizations/test-org/tags/", () =>
        HttpResponse.json([
          { key: "browser", name: "Browser", totalValues: 10 },
          { key: "device", name: "Device", totalValues: 5 },
          { key: "os", name: "Operating System", totalValues: 8 },
        ]),
      ),
      http.get("https://sentry.io/api/0/organizations/test-org/events/", () =>
        HttpResponse.json({
          data: [
            {
              id: "error1",
              message: "Uncaught TypeError: Cannot read property 'foo' of null",
              level: "error",
              culprit: "app.js in handleClick",
              title: "TypeError: Cannot read property 'foo' of null",
              timestamp: "2024-01-15T10:30:00Z",
              project: "frontend",
            },
          ],
        }),
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "null pointer exceptions",
        limit: 10,
        dataset: "errors",
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

    expect(result).toContain("Found 1 error:");
    expect(result).toContain("TypeError: Cannot read property 'foo' of null");
    expect(result).toContain("**level**: error");
    expect(result).toContain("**culprit**: app.js in handleClick");
  });

  it("handles non-existent project gracefully", async () => {
    mockGenerateObject.mockResolvedValueOnce(
      mockAIResponse("level:error", "spans"),
    );

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("itemType")).toBe("spans");
          const attributeType = url.searchParams.get("attributeType");
          expect(["string", "number"].includes(attributeType!)).toBe(true);
          return HttpResponse.json([]);
        },
      ),
      // Mock the project endpoint returning 404 for non-existent project
      http.get(
        "https://sentry.io/api/0/projects/test-org/non-existent-project/",
        () =>
          HttpResponse.json({ detail: "Project not found" }, { status: 404 }),
      ),
    );

    await expect(
      searchEvents.handler(
        {
          organizationSlug: "test-org",
          naturalLanguageQuery: "errors",
          projectSlug: "non-existent-project",
          limit: 10,
          dataset: "spans",
          includeExplanation: false,
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

  it("handles timestamp queries with correct format", async () => {
    // Test that timestamp queries use the correct format
    mockGenerateObject.mockResolvedValueOnce(
      mockAIResponse('message:"timeout" AND timestamp:-1h', "errors"),
    );

    mswServer.use(
      http.get("https://sentry.io/api/0/organizations/test-org/tags/", () =>
        HttpResponse.json([]),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          const query = url.searchParams.get("query");

          // Verify the query has correct timestamp format
          expect(query).toBe('message:"timeout" AND timestamp:-1h');

          return HttpResponse.json({
            data: [
              {
                id: "error1",
                message: "Request timeout",
                level: "error",
                culprit: "api.request",
                title: "Timeout Error",
                timestamp: "2024-01-15T10:30:00Z",
                project: "backend",
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "timeout errors in the last hour",
        limit: 10,
        dataset: "errors",
        includeExplanation: true,
        projectSlug: undefined,
        regionUrl: undefined,
      },
      {
        accessToken: "test-token",
        userId: "1",
        organizationSlug: null,
      },
    );

    // Verify the translation is shown correctly with timestamp
    expect(result).toContain(
      'Sentry query: `message:"timeout" AND timestamp:-1h`',
    );
    expect(result).toContain("Found 1 error:");
    expect(result).toContain("Timeout Error");

    // Verify the AI was called with system prompt that includes timestamp format
    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("timestamp:-1h"),
      }),
    );
  });

  it("respects the limit parameter", async () => {
    mockGenerateObject.mockResolvedValueOnce(
      mockAIResponse("level:error", "spans"),
    );

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("itemType")).toBe("spans");
          const attributeType = url.searchParams.get("attributeType");
          expect(["string", "number"].includes(attributeType!)).toBe(true);
          return HttpResponse.json([]);
        },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("per_page")).toBe("5");

          return HttpResponse.json({ data: [] });
        },
      ),
    );

    await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "errors",
        limit: 5,
        dataset: "spans",
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

  it("should handle AI error responses gracefully", async () => {
    // Mock AI returning an error
    mockGenerateObject.mockResolvedValueOnce(
      mockAIResponse(
        "",
        "errors",
        "Cannot translate this query - it's too ambiguous",
      ),
    );

    await expect(
      searchEvents.handler(
        {
          organizationSlug: "test-org",
          naturalLanguageQuery: "some impossible query",
          dataset: "errors",
          limit: 10,
          includeExplanation: false,
        },
        {
          accessToken: "test-token",
          organizationSlug: "test-org",
          userId: "1",
        },
      ),
    ).rejects.toThrow(
      /AI could not translate query "some impossible query" for errors dataset.*Cannot translate this query - it's too ambiguous/,
    );
  });

  it("should handle missing query from AI by using empty query", async () => {
    // Mock AI returning no query - using a custom object that doesn't include query
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        fields: ["timestamp", "message"],
        sort: "-timestamp",
        // No query field
      },
      finishReason: "stop" as const,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      warnings: [] as const,
      request: {},
      response: {
        id: "test-response-id",
        timestamp: new Date(),
        modelId: "gpt-4o",
      },
      experimental_providerMetadata: undefined,
      logprobs: undefined,
      get providerMetadata() {
        return this.response;
      },
      toJsonResponse: () => ({ object: { fields: ["timestamp", "message"] } }),
    } as any);

    mswServer.use(
      http.get("https://sentry.io/api/0/organizations/test-org/tags/", () =>
        HttpResponse.json([]),
      ),
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          const query = url.searchParams.get("query");

          // Should use empty string as query
          expect(query).toBe("");

          return HttpResponse.json({
            data: [
              {
                id: "error1",
                message: "Latest error",
                level: "error",
                timestamp: "2024-01-15T10:30:00Z",
                project: "backend",
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        naturalLanguageQuery: "latest logs",
        dataset: "errors",
        limit: 10,
        includeExplanation: false,
      },
      {
        accessToken: "test-token",
        organizationSlug: "test-org",
        userId: "1",
      },
    );

    expect(result).toContain("Found 1 error:");
    expect(result).toContain("Latest error");
  });
});

// Integration test that uses real OpenAI API
describe("search_events integration test", () => {
  it.skipIf(!process.env.OPENAI_API_KEY)(
    "should work with real OpenAI API",
    async () => {
      // This test uses the real OpenAI API to ensure our generateObject integration works
      // It only runs if OPENAI_API_KEY is set in the environment

      // Mock the Sentry API calls but use real OpenAI
      mswServer.use(
        // Mock the tags endpoint for errors dataset
        http.get(
          "https://sentry.io/api/0/organizations/test-org/tags/",
          () => {
            return HttpResponse.json([
              { key: "custom.field", name: "Custom Field" },
            ]);
          },
          { once: true },
        ),

        // Mock the search events endpoint
        http.get(
          "https://sentry.io/api/0/organizations/test-org/events/",
          () => {
            return HttpResponse.json({
              data: [
                {
                  issue: "TEST-123",
                  title: "Test Error",
                  project: "test-project",
                  timestamp: "2025-07-14T20:49:44.000Z",
                  level: "error",
                  message: "Test error message",
                  "error.type": "TestError",
                  culprit: "test.js",
                },
              ],
            });
          },
          { once: true },
        ),
      );

      // Unmock the AI module for this test to use the real implementation
      vi.doUnmock("ai");
      vi.doUnmock("@ai-sdk/openai");

      // Import the real module after unmocking
      const realSearchEvents = await import("./search-events.js");

      const result = await realSearchEvents.default.handler(
        {
          organizationSlug: "test-org",
          naturalLanguageQuery: "database connection errors",
          dataset: "errors" as const,
          limit: 10,
          includeExplanation: false,
        },
        {
          accessToken: "test-token",
          organizationSlug: "test-org",
          userId: "test-user",
        },
      );

      // Verify the result is a string (formatted output)
      expect(typeof result).toBe("string");
      expect(result).toContain("Search Results for");
      expect(result).toContain("database connection errors");
      expect(result).toContain("TEST-123");

      // Re-mock for other tests
      vi.doMock("ai", () => ({
        generateObject: vi.fn(() =>
          Promise.resolve({
            object: {
              query: "mocked query",
              fields: [
                "issue",
                "title",
                "project",
                "timestamp",
                "level",
                "message",
                "error.type",
                "culprit",
              ],
            },
          }),
        ),
      }));
    },
  );
});
