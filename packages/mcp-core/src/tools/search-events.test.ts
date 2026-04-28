import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import searchEvents from "./search-events";
import { generateText } from "ai";
import { UserInputError } from "../errors";

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

describe("search_events", () => {
  const mockGenerateText = vi.mocked(generateText);

  // Helper to create AI response for different datasets
  const mockAIResponse = (
    dataset: "errors" | "logs" | "spans" | "metrics" | "profiles" | "replays",
    query = "test query",
    fields?: string[],
    errorMessage?: string,
    sort?: string,
    timeRange?: { statsPeriod: string } | { start: string; end: string },
    environment?: string | string[] | null,
  ) => {
    const defaultFields = {
      errors: ["issue", "title", "project", "timestamp", "level", "message"],
      logs: ["timestamp", "project", "message", "severity", "trace"],
      spans: [
        "span.op",
        "span.description",
        "span.duration",
        "transaction",
        "timestamp",
        "project",
      ],
      metrics: [
        "timestamp",
        "project",
        "metric.name",
        "metric.type",
        "metric.unit",
        "value",
        "trace",
      ],
      profiles: [
        "project",
        "profile.id",
        "timestamp",
        "transaction",
        "transaction.duration",
        "release",
        "trace",
      ],
      replays: [],
    };

    const defaultSorts = {
      errors: "-timestamp",
      logs: "-timestamp",
      spans: "-span.duration",
      metrics: "-timestamp",
      profiles: "-timestamp",
      replays: "-started_at",
    };

    const output = errorMessage
      ? { error: errorMessage }
      : {
          dataset,
          query,
          fields: fields ?? defaultFields[dataset],
          sort: sort ?? defaultSorts[dataset],
          environment: environment ?? null,
          timeRange: timeRange ?? null,
          explanation: "Test query translation",
        };

    return {
      text: JSON.stringify(output),
      experimental_output: output,
      finishReason: "stop" as const,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      warnings: [] as const,
    } as any;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    mockGenerateText.mockResolvedValue(mockAIResponse("errors"));
  });

  it("should handle spans dataset queries", async () => {
    // Mock AI response for spans dataset
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse("spans", 'span.op:"db.query"', [
        "span.op",
        "span.description",
        "span.duration",
      ]),
    );

    // Mock the Sentry API response
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("spans");
          return HttpResponse.json({
            data: [
              {
                id: "span1",
                "span.op": "db.query",
                "span.description": "SELECT * FROM users",
                "span.duration": 1500,
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "database queries",
        dataset: "errors",
        fields: null,
        sort: "-timestamp",
        statsPeriod: "14d",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(mockGenerateText).toHaveBeenCalled();
    expect(result).toContain("span1");
    expect(result).toContain("db.query");
  });

  it("should handle metrics dataset queries", async () => {
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse(
        "metrics",
        "",
        [
          "transaction",
          "p95(value,http.request.duration,distribution,millisecond)",
          "count(value,http.request.duration,distribution,millisecond)",
        ],
        undefined,
        "-p95(value,http.request.duration,distribution,millisecond)",
      ),
    );

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("tracemetrics");
          expect(url.searchParams.get("sort")).toBe(
            "-p95(value,http.request.duration,distribution,millisecond)",
          );
          return HttpResponse.json({
            data: [
              {
                transaction: "GET /api/users",
                "p95(value,http.request.duration,distribution,millisecond)": 320,
                "count(value,http.request.duration,distribution,millisecond)": 42,
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "slow request duration metrics",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(result).toMatchInlineSnapshot(`
      "# Search Results for "slow request duration metrics"

      ⚠️ **IMPORTANT**: Display these metric aggregates as a data table with proper column alignment, grouping labels, and units.

      **View these results in Sentry**:
      https://test-org.sentry.io/explore/metrics/?statsPeriod=14d&metric=%7B%22metric%22%3A%7B%22name%22%3A%22http.request.duration%22%2C%22type%22%3A%22distribution%22%2C%22unit%22%3A%22millisecond%22%7D%2C%22query%22%3A%22%22%2C%22aggregateFields%22%3A%5B%7B%22yAxes%22%3A%5B%22p95%28value%2Chttp.request.duration%2Cdistribution%2Cmillisecond%29%22%5D%7D%2C%7B%22yAxes%22%3A%5B%22count%28value%2Chttp.request.duration%2Cdistribution%2Cmillisecond%29%22%5D%7D%2C%7B%22groupBy%22%3A%22transaction%22%7D%5D%2C%22aggregateSortBys%22%3A%5B%7B%22field%22%3A%22p95%28value%2Chttp.request.duration%2Cdistribution%2Cmillisecond%29%22%2C%22kind%22%3A%22desc%22%7D%5D%2C%22mode%22%3A%22aggregate%22%7D
      _Please share this link with the user to view the search results in their Sentry dashboard._

      Found 1 aggregate result:

      \`\`\`json
      [
        {
          "transaction": "GET /api/users",
          "p95(value,http.request.duration,distribution,millisecond)": 320,
          "count(value,http.request.duration,distribution,millisecond)": 42
        }
      ]
      \`\`\`

      ## Next Steps

      - Open the Metrics page link above to refine the selected metric
      - Drill into a specific sample by opening its Trace URL or using \`get_sentry_resource\` with that trace ID
      - Metrics do not expose a standalone detail resource here; use the related trace for deeper inspection
      - Group by additional attributes to break down the metric further
      - Switch between samples and aggregates in Sentry for deeper analysis
      "
    `);
  });

  it("should request trace metric identity fields for metrics sample queries", async () => {
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse(
        "metrics",
        "",
        ["timestamp", "value"],
        undefined,
        "-timestamp",
      ),
    );

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);

          expect(url.searchParams.getAll("field")).toEqual([
            "timestamp",
            "value",
            "metric.name",
            "metric.type",
            "metric.unit",
          ]);

          return HttpResponse.json({
            data: [
              {
                timestamp: "2026-04-13T14:19:18+00:00",
                value: 12.4,
                trace: "6a477f5b0f31ef7b6b9b5e1dea66c91d",
                "metric.name": "http.request.duration",
                "metric.type": "distribution",
                "metric.unit": "millisecond",
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "recent metrics",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(typeof result).toBe("string");
    if (typeof result !== "string") {
      throw new Error("Expected string result");
    }

    const urlMatch = result.match(/https:\/\/[^\n]+/);
    expect(urlMatch).not.toBeNull();

    const url = new URL(urlMatch![0]);
    const metricQuery = JSON.parse(url.searchParams.get("metric")!);

    expect(url.pathname).toBe("/explore/metrics/");
    expect(metricQuery.metric).toEqual({
      name: "http.request.duration",
      type: "distribution",
      unit: "millisecond",
    });
    expect(metricQuery.mode).toBe("samples");
    expect(metricQuery.aggregateFields).toEqual([{ yAxes: ["sum(value)"] }]);
  });

  it("should handle profiles dataset queries", async () => {
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse(
        "profiles",
        "transaction:/api/users",
        [
          "project",
          "profile.id",
          "timestamp",
          "transaction",
          "transaction.duration",
          "release",
          "trace",
          "precise.start_ts",
          "precise.finish_ts",
        ],
        undefined,
        "-timestamp",
      ),
    );

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("profiles");
          return HttpResponse.json({
            data: [
              {
                project: "backend",
                "profile.id": "cfe78a5c892d4a64a962d837673398d2",
                timestamp: "2025-01-15T10:00:00Z",
                transaction: "/api/users",
                "transaction.duration": 120000000,
                release: "backend@1.2.3",
                trace: "a4d1aae7216b47ff8117cf4e09ce9d0a",
                "precise.start_ts": "2025-01-15T10:00:00Z",
                "precise.finish_ts": "2025-01-15T10:00:00.120Z",
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "recent profiles for /api/users",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(result).toContain("https://test-org.sentry.io/explore/profiling/");
    expect(result).toContain(
      "https://test-org.sentry.io/explore/profiling/profile/backend/cfe78a5c892d4a64a962d837673398d2/flamegraph/",
    );
    expect(result).toContain("**transaction.duration**: 120ms");
  });

  it("should build continuous profile links when precise timestamps are exact strings", async () => {
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse(
        "profiles",
        "transaction:/api/users",
        [
          "project",
          "profiler.id",
          "timestamp",
          "transaction",
          "transaction.duration",
          "trace",
          "precise.start_ts",
          "precise.finish_ts",
        ],
        undefined,
        "-timestamp",
      ),
    );

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("profiles");
          return HttpResponse.json({
            data: [
              {
                project: "backend",
                "profiler.id": "7d0d8b4ef0c74b07a3d48886e9b198e5",
                timestamp: "2025-01-15T10:00:00Z",
                transaction: "/api/users",
                "transaction.duration": 120000000,
                trace: "a4d1aae7216b47ff8117cf4e09ce9d0a",
                "precise.start_ts": "1736935200000000000",
                "precise.finish_ts": "1736935200120000000",
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "recent profiles for /api/users",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(result).toContain(
      "https://test-org.sentry.io/explore/profiling/profile/backend/flamegraph/?profilerId=7d0d8b4ef0c74b07a3d48886e9b198e5&start=1736935200000000000&end=1736935200120000000",
    );
    expect(result).toContain("**transaction.duration**: 120ms");
  });

  it("should omit continuous profile links when precise timestamps are unsafe numbers", async () => {
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse(
        "profiles",
        "transaction:/api/users",
        [
          "project",
          "profiler.id",
          "timestamp",
          "transaction",
          "transaction.duration",
          "trace",
          "precise.start_ts",
          "precise.finish_ts",
        ],
        undefined,
        "-timestamp",
      ),
    );

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("profiles");
          return HttpResponse.json({
            data: [
              {
                project: "backend",
                "profiler.id": "7d0d8b4ef0c74b07a3d48886e9b198e5",
                timestamp: "2025-01-15T10:00:00Z",
                transaction: "/api/users",
                "transaction.duration": 120000000,
                trace: "a4d1aae7216b47ff8117cf4e09ce9d0a",
                "precise.start_ts": 1736935200000000000,
                "precise.finish_ts": 1736935200120000000,
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "recent profiles for /api/users",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(result).not.toContain(
      "**Profile URL**: https://test-org.sentry.io/explore/profiling/profile/backend/flamegraph/?profilerId=7d0d8b4ef0c74b07a3d48886e9b198e5",
    );
    expect(result).toContain("**transaction.duration**: 120ms");
  });

  it("should preserve grouped profile fields in the explorer URL", async () => {
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse(
        "profiles",
        "",
        ["release", "count()"],
        undefined,
        "-count()",
      ),
    );

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("profiles");
          return HttpResponse.json({
            data: [
              {
                release: "backend@1.2.3",
                "count()": 3,
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "count profiles by release",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(typeof result).toBe("string");
    if (typeof result !== "string") {
      throw new Error("Expected string result");
    }

    const urlMatch = result.match(/https:\/\/[^\n]+/);
    expect(urlMatch).not.toBeNull();

    const url = new URL(urlMatch![0]);

    expect(url.pathname).toBe("/explore/profiling/");
    expect(url.searchParams.get("sort")).toBe("-count()");
    expect(url.searchParams.getAll("field")).toEqual(["release", "count()"]);
  });

  it("should omit profile detail links when only project.name is selected", async () => {
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse(
        "profiles",
        "transaction:/api/users",
        [
          "project.name",
          "profile.id",
          "timestamp",
          "transaction",
          "transaction.duration",
        ],
        undefined,
        "-timestamp",
      ),
    );

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("profiles");
          return HttpResponse.json({
            data: [
              {
                "project.name": "Backend API",
                "profile.id": "cfe78a5c892d4a64a962d837673398d2",
                timestamp: "2025-01-15T10:00:00Z",
                transaction: "/api/users",
                "transaction.duration": 120000000,
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "recent profiles for /api/users",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(result).not.toContain("**Profile URL**:");
    expect(result).not.toContain("/profile/Backend API/");
    expect(result).toContain("**project.name**: Backend API");
  });

  it("should handle replay dataset queries through search_events", async () => {
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse(
        "replays",
        "url:*checkout* count_errors:>0",
        [],
        undefined,
        "-count_errors",
        { statsPeriod: "24h" },
        ["production", "staging"],
      ),
    );

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/replays/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("query")).toBe(
            "url:*checkout* count_errors:>0",
          );
          expect(url.searchParams.get("sort")).toBe("-count_errors");
          expect(url.searchParams.getAll("environment")).toEqual([
            "production",
            "staging",
          ]);
          expect(url.searchParams.get("statsPeriod")).toBe("24h");
          return HttpResponse.json({
            data: [
              {
                id: "7e07485f12f9416b8b1426260799b51f",
                duration: 576,
                environment: "production",
                count_errors: 2,
                count_rage_clicks: 1,
                count_dead_clicks: 3,
                started_at: "2025-01-15T10:00:00Z",
                browser: { name: "Chrome", version: "131.0.0" },
                user: { display_name: "Jane Doe" },
                urls: ["/checkout", "/checkout/payment", "/checkout/confirm"],
                releases: ["frontend@1.2.3"],
                trace_ids: ["a4d1aae7216b47ff8117cf4e09ce9d0a"],
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "production checkout replays with errors in the last day",
        limit: 10,
        includeExplanation: true,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(result).toContain("https://test-org.sentry.io/explore/replays/");
    expect(result).toContain("environment=production&environment=staging");
    expect(result).toContain("Environment: production, staging");
    expect(result).toContain("Jane Doe");
    expect(result).toContain("2 errors");
  });

  it("should handle errors dataset queries", async () => {
    // Mock AI response for errors dataset
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse("errors", "level:error", [
        "issue",
        "title",
        "level",
        "timestamp",
      ]),
    );

    // Mock the Sentry API response
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("errors");
          return HttpResponse.json({
            data: [
              {
                id: "error1",
                issue: "PROJ-123",
                title: "Database Connection Error",
                level: "error",
                timestamp: "2024-01-15T10:30:00Z",
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "database errors",
        dataset: "errors",
        fields: null,
        sort: "-timestamp",
        statsPeriod: "14d",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(mockGenerateText).toHaveBeenCalled();
    expect(result).toContain("Database Connection Error");
    expect(result).toContain("PROJ-123");
  });

  it("should format object fields without [object Object] output", async () => {
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse("errors", "issue:PROJ-123", [
        "title",
        "timestamp",
        "user",
        "tags",
      ]),
    );

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("errors");
          return HttpResponse.json({
            data: [
              {
                id: "error1",
                title: "WatchdogTermination",
                timestamp: "2024-01-15T10:30:00Z",
                user: {
                  id: "user-123",
                  email: "foo@example.com",
                  ip_address: "10.0.0.1",
                },
                tags: [
                  { key: "os", value: "iOS 17" },
                  { key: "device", value: "iPhone15,3" },
                ],
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "recent errors with user data",
        dataset: "errors",
        fields: null,
        sort: "-timestamp",
        statsPeriod: "14d",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(result).toContain("email=foo@example.com");
    expect(result).toContain("os=iOS 17");
    expect(result).not.toContain("[object Object]");
  });

  it("should render geo-only users without raw user JSON in error results", async () => {
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse("errors", "issue:PROJ-123", [
        "title",
        "timestamp",
        "user",
      ]),
    );

    mswServer.use(
      http.get("https://sentry.io/api/0/organizations/test-org/events/", () => {
        return HttpResponse.json({
          data: [
            {
              id: "error1",
              title: "Geo-only User Error",
              timestamp: "2024-01-15T10:30:00Z",
              user: {
                geo: {
                  country_code: "US",
                  region: "United States",
                },
              },
            },
          ],
        });
      }),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "recent errors with geo-only user data",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(result).toContain("**user.geo**: US, United States");
    expect(result).not.toContain('**user**: {"geo"');
    expect(result).not.toContain("**user**:");
  });

  it("should render log user geo on a dedicated line", async () => {
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse("logs", "user logs", [
        "timestamp",
        "message",
        "severity",
        "user",
      ]),
    );

    mswServer.use(
      http.get("https://sentry.io/api/0/organizations/test-org/events/", () => {
        return HttpResponse.json({
          data: [
            {
              timestamp: "2024-01-15T10:30:00Z",
              message: "User log message",
              severity: "info",
              user: {
                id: "user-123",
                geo: {
                  country_code: "US",
                  region: "United States",
                },
              },
            },
          ],
        });
      }),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "logs with user geo",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(result).toContain("- **user**: id=user-123");
    expect(result).toContain("- **user.geo**: US, United States");
    expect(result).not.toContain(
      "- **user**: id=user-123, geo=US, United States",
    );
  });

  it("should render span user geo on a dedicated line", async () => {
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse("spans", "span users", [
        "span.description",
        "span.duration",
        "timestamp",
        "user",
      ]),
    );

    mswServer.use(
      http.get("https://sentry.io/api/0/organizations/test-org/events/", () => {
        return HttpResponse.json({
          data: [
            {
              id: "span1",
              "span.description": "SELECT * FROM users",
              "span.duration": 1500,
              timestamp: "2024-01-15T10:30:00Z",
              user: {
                id: "user-123",
                geo: {
                  country_code: "US",
                  region: "United States",
                },
              },
            },
          ],
        });
      }),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "spans with user geo",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(result).toContain("**user**: id=user-123");
    expect(result).toContain("**user.geo**: US, United States");
    expect(result).not.toContain(
      "**user**: id=user-123, geo=US, United States",
    );
  });

  it("should handle logs dataset queries", async () => {
    // Mock AI response for logs dataset
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse("logs", "severity:error", [
        "timestamp",
        "message",
        "severity",
      ]),
    );

    // Mock the Sentry API response
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("logs"); // API now accepts "logs" directly
          return HttpResponse.json({
            data: [
              {
                id: "log1",
                timestamp: "2024-01-15T10:30:00Z",
                message: "Connection failed to database",
                severity: "error",
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "error logs",
        dataset: "errors",
        fields: null,
        sort: "-timestamp",
        statsPeriod: "14d",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(mockGenerateText).toHaveBeenCalled();
    expect(result).toContain("Connection failed to database");
    expect(result).toContain("🔴 [ERROR]");
  });

  it("should repair direct search params with the agent when available", async () => {
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse("logs", "severity:error", [
        "timestamp",
        "message",
        "severity",
      ]),
    );

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("logs");
          expect(url.searchParams.get("query")).toBe("severity:error");
          return HttpResponse.json({
            data: [
              {
                id: "log1",
                timestamp: "2024-01-15T10:30:00Z",
                message: "Connection failed to database",
                severity: "error",
              },
            ],
          });
        },
      ),
    );

    await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "severity:error",
        dataset: "errors",
        fields: ["timestamp", "message", "level"],
        sort: "-timestamp",
        statsPeriod: "14d",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    const prompt = mockGenerateText.mock.calls[0]?.[0]?.prompt;
    expect(prompt).toContain("Fix this Sentry event search request");
    expect(prompt).toContain("severity:error");
    expect(prompt).toContain('"dataset": "errors"');
  });

  it("should handle AI agent errors gracefully", async () => {
    // Mock AI response with error
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse("errors", "", [], "Cannot parse this query"),
    );

    const promise = searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "some impossible query !@#$%",
        dataset: "errors",
        fields: null,
        sort: "-timestamp",
        statsPeriod: "14d",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    await expect(promise).rejects.toThrow(UserInputError);
    await expect(promise).rejects.toThrow("Cannot parse this query");
  });

  it("should reject agent responses with empty sort", async () => {
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse(
        "errors",
        "level:error",
        ["timestamp", "title"],
        undefined,
        "",
      ),
    );

    const promise = searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "recent errors",
        dataset: "errors",
        fields: null,
        sort: "-timestamp",
        statsPeriod: "14d",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    await expect(promise).rejects.toThrow(UserInputError);
    await expect(promise).rejects.toThrow("missing required 'sort'");
  });

  it("should return UserInputError for time series queries", async () => {
    // Mock AI response with time series error
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse(
        "errors",
        "",
        [],
        "Time series aggregations are not currently supported.",
      ),
    );

    const promise = searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "show me errors over time",
        dataset: "errors",
        fields: null,
        sort: "-timestamp",
        statsPeriod: "14d",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    // Check that it throws UserInputError
    await expect(promise).rejects.toThrow(UserInputError);

    // Check that the error message contains the expected text
    await expect(promise).rejects.toThrow(
      "Time series aggregations are not currently supported",
    );
  });

  it("should handle API errors gracefully", async () => {
    // Mock successful AI response
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse("errors", "level:error"),
    );

    // Mock API error
    mswServer.use(
      http.get("https://sentry.io/api/0/organizations/test-org/events/", () =>
        HttpResponse.json(
          { detail: "Organization not found" },
          { status: 404 },
        ),
      ),
    );

    await expect(
      searchEvents.handler(
        {
          organizationSlug: "test-org",
          regionUrl: null,
          projectSlug: null,
          query: "any query",
          dataset: "errors",
          fields: null,
          sort: "-timestamp",
          statsPeriod: "14d",
          limit: 10,
          includeExplanation: false,
        },
        {
          constraints: {
            organizationSlug: null,
            regionUrl: null,
            projectSlug: null,
          },
          accessToken: "test-token",
          userId: "1",
        },
      ),
    ).rejects.toThrow();
  });

  it("should handle missing sort parameter", async () => {
    // Mock AI response missing sort parameter - schema.parse() will catch this
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        dataset: "errors",
        query: "test",
        fields: ["title"],
      }),
      experimental_output: {
        dataset: "errors",
        query: "test",
        fields: ["title"],
        timeRange: null,
      },
    } as any);

    await expect(
      searchEvents.handler(
        {
          organizationSlug: "test-org",
          regionUrl: null,
          projectSlug: null,
          query: "any query",
          dataset: "errors",
          fields: null,
          sort: "-timestamp",
          statsPeriod: "14d",
          limit: 10,
          includeExplanation: false,
        },
        {
          constraints: {
            organizationSlug: null,
            regionUrl: null,
            projectSlug: null,
          },
          accessToken: "test-token",
          userId: "1",
        },
      ),
    ).rejects.toThrow(UserInputError);
  });

  it("should handle agent self-correction when sort field not in fields array", async () => {
    // First call: Agent returns sort field not in fields (will fail validation)
    // Second call: Agent self-corrects by adding sort field to fields array
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        dataset: "errors",
        query: "test",
        fields: ["title", "timestamp"], // Added timestamp after self-correction
        sort: "-timestamp",
      }),
      experimental_output: {
        dataset: "errors",
        query: "test",
        fields: ["title", "timestamp"],
        sort: "-timestamp",
        timeRange: null,
        explanation: "Self-corrected to include sort field in fields array",
      },
    } as any);

    // Mock the Sentry API response
    mswServer.use(
      http.get("https://sentry.io/api/0/organizations/test-org/events/", () => {
        return HttpResponse.json({
          data: [
            {
              id: "error1",
              title: "Test Error",
              timestamp: "2024-01-15T10:30:00Z",
            },
          ],
        });
      }),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "recent errors",
        dataset: "errors",
        fields: null,
        sort: "-timestamp",
        statsPeriod: "14d",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    // Verify the agent was called and result contains the data
    expect(mockGenerateText).toHaveBeenCalled();
    expect(result).toContain("Test Error");
  });

  it("should correctly handle user agent queries", async () => {
    // Mock AI response for user agent query in spans dataset
    mockGenerateText.mockResolvedValueOnce(
      mockAIResponse(
        "spans",
        "has:mcp.tool.name AND has:user_agent.original",
        ["user_agent.original", "count()"],
        undefined,
        "-count()",
        { statsPeriod: "24h" },
      ),
    );

    // Mock the Sentry API response
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("spans");
          expect(url.searchParams.get("query")).toBe(
            "has:mcp.tool.name AND has:user_agent.original",
          );
          expect(url.searchParams.get("sort")).toBe("-count"); // API transforms count() to count
          expect(url.searchParams.get("statsPeriod")).toBe("24h");
          // Verify it's using user_agent.original, not user.id
          expect(url.searchParams.getAll("field")).toContain(
            "user_agent.original",
          );
          expect(url.searchParams.getAll("field")).toContain("count()");
          return HttpResponse.json({
            data: [
              {
                "user_agent.original":
                  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "count()": 150,
              },
              {
                "user_agent.original":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "count()": 120,
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        query: "which user agents have the most tool calls yesterday",
        dataset: "errors",
        fields: null,
        sort: "-timestamp",
        statsPeriod: "14d",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    expect(mockGenerateText).toHaveBeenCalled();
    expect(result).toContain("Mozilla/5.0");
    expect(result).toContain("150");
    expect(result).toContain("120");
    // Should NOT contain user.id references
    expect(result).not.toContain("user.id");
  });

  it("should search events with direct query syntax (no agent)", async () => {
    process.env.OPENAI_API_KEY = "";
    process.env.ANTHROPIC_API_KEY = "";

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/events/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("dataset")).toBe("errors");
          expect(url.searchParams.get("query")).toBe("level:error");
          expect(url.searchParams.get("sort")).toBe("-timestamp");
          return HttpResponse.json({
            data: [
              {
                id: "error1",
                issue: "PROJ-123",
                title: "Database Error",
                level: "error",
                timestamp: "2024-01-15T10:30:00Z",
              },
            ],
          });
        },
      ),
    );

    const result = await searchEvents.handler(
      {
        organizationSlug: "test-org",
        regionUrl: null,
        projectSlug: null,
        dataset: "errors",
        query: "level:error",
        fields: ["issue", "title", "level", "timestamp"],
        sort: "-timestamp",
        statsPeriod: "14d",
        limit: 10,
        includeExplanation: false,
      },
      {
        constraints: {
          organizationSlug: null,
          regionUrl: null,
          projectSlug: null,
        },
        accessToken: "test-token",
        userId: "1",
      },
    );

    // Should NOT have called the AI agent
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(result).toContain("Database Error");
  });
});
