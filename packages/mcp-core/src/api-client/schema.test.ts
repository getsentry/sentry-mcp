import { describe, expect, it } from "vitest";
import { IssueSchema, EventSchema } from "./schema";

describe("IssueSchema", () => {
  it("should parse a standard error issue", () => {
    const errorIssue = {
      id: "123456",
      shortId: "PROJECT-123",
      title: "TypeError: Cannot read property 'foo' of undefined",
      firstSeen: "2025-01-01T00:00:00Z",
      lastSeen: "2025-01-02T00:00:00Z",
      count: "42",
      userCount: 10,
      permalink: "https://sentry.io/issues/123456/",
      project: {
        id: "1",
        name: "test-project",
        slug: "test-project",
        platform: "javascript",
      },
      platform: "javascript",
      status: "unresolved",
      culprit: "app/components/Widget.js",
      type: "error",
      metadata: {
        title: "TypeError",
        value: "Cannot read property 'foo' of undefined",
      },
    };

    const result = IssueSchema.parse(errorIssue);
    expect(result).toEqual(errorIssue);
  });

  it("should allow issues with null lastSeen", () => {
    const staleIssue = {
      id: "321",
      shortId: "TEST-321",
      title: "Intermittent crash",
      firstSeen: "2025-01-01T00:00:00Z",
      lastSeen: null,
      count: 0,
      userCount: 0,
      permalink: "https://sentry.io/issues/321/",
      project: {
        id: "1",
        name: "stale-project",
        slug: "stale-project",
      },
      status: "resolved",
      culprit: "stale.ts",
      type: "error",
    };

    const result = IssueSchema.parse(staleIssue);

    expect(result.lastSeen).toBeNull();
  });

  it("should parse a regressed performance issue", () => {
    // Anonymized payload from real regressed issue (issue #633)
    const regressedIssue = {
      id: "6898891101",
      shareId: null,
      shortId: "MCP-SERVER-EQE",
      title: "Endpoint Regression",
      culprit: "POST /oauth/token",
      permalink: "https://sentry.sentry.io/issues/6898891101/",
      logger: null,
      level: "info",
      status: "unresolved",
      statusDetails: {},
      substatus: "regressed", // Key field for regressed issues
      isPublic: false,
      platform: "python",
      project: {
        id: "4509062593708032",
        name: "mcp-server",
        slug: "mcp-server",
        platform: "node-cloudflare-workers",
      },
      type: "generic", // Performance issues use "generic" type
      metadata: {
        title: "Endpoint Regression",
        value: "Increased from 909.77ms to 1711.36ms (P95)",
        initial_priority: 50, // Additional field not in base schema
      },
      numComments: 0,
      assignedTo: null,
      isBookmarked: false,
      isSubscribed: false,
      subscriptionDetails: null,
      hasSeen: true,
      annotations: [],
      issueType: "performance_p95_endpoint_regression",
      issueCategory: "metric",
      priority: "medium",
      priorityLockedAt: null,
      seerFixabilityScore: 0.281737357378006,
      seerAutofixLastTriggered: "2025-09-24T03:02:31.724243Z",
      isUnhandled: false,
      count: "3",
      userCount: 0,
      firstSeen: "2025-09-24T03:02:10.919020Z",
      lastSeen: "2025-11-18T06:01:20Z",
      firstRelease: null,
      lastRelease: null,
      tags: [
        { key: "level", name: "Level", totalValues: 3 },
        { key: "transaction", name: "Transaction", totalValues: 3 },
      ],
      activity: [
        {
          id: "5393778915",
          user: null,
          sentry_app: null,
          type: "set_regression",
          data: {
            event_id: "a6251c18f0194b8e8158518b8ee99545",
            version: "",
          },
          dateCreated: "2025-11-18T06:01:22.267515Z",
        },
      ],
      seenBy: [],
      pluginActions: [],
      pluginIssues: [],
      pluginContexts: [],
      userReportCount: 0,
      stats: {
        "24h": [],
        "30d": [],
      },
      participants: [],
    };

    // This should not throw - if it does, the schema is too strict
    const result = IssueSchema.parse(regressedIssue);

    expect(result.shortId).toBe("MCP-SERVER-EQE");
    expect(result.type).toBe("generic");
    expect(result.issueType).toBe("performance_p95_endpoint_regression");
    expect(result.issueCategory).toBe("metric");
  });

  it("should parse a transaction issue", () => {
    const transactionIssue = {
      id: "789",
      shortId: "PERF-42",
      title: "Slow Database Query",
      firstSeen: "2025-01-01T00:00:00Z",
      lastSeen: "2025-01-02T00:00:00Z",
      count: 100,
      userCount: 25,
      permalink: "https://sentry.io/issues/789/",
      project: {
        id: "2",
        name: "backend",
        slug: "backend",
        platform: "python",
      },
      platform: "python",
      status: "unresolved",
      culprit: "api/queries.py",
      type: "transaction",
    };

    const result = IssueSchema.parse(transactionIssue);
    expect(result.type).toBe("transaction");
  });

  it("should handle issues with assignedTo as string", () => {
    const issue = {
      id: "999",
      shortId: "TEST-99",
      title: "Test Issue",
      firstSeen: "2025-01-01T00:00:00Z",
      lastSeen: "2025-01-02T00:00:00Z",
      count: 1,
      userCount: 1,
      permalink: "https://sentry.io/issues/999/",
      project: {
        id: "3",
        name: "test",
        slug: "test",
        platform: "node",
      },
      status: "unresolved",
      culprit: "test.js",
      type: "error",
      assignedTo: "user@example.com",
    };

    const result = IssueSchema.parse(issue);
    expect(result.assignedTo).toBe("user@example.com");
  });

  it("should handle issues with assignedTo as object", () => {
    const issue = {
      id: "888",
      shortId: "TEST-88",
      title: "Test Issue",
      firstSeen: "2025-01-01T00:00:00Z",
      lastSeen: "2025-01-02T00:00:00Z",
      count: 1,
      userCount: 1,
      permalink: "https://sentry.io/issues/888/",
      project: {
        id: "4",
        name: "test",
        slug: "test",
        platform: "node",
      },
      status: "unresolved",
      culprit: "test.js",
      type: "error",
      assignedTo: {
        type: "team",
        id: "123",
        name: "Backend Team",
      },
    };

    const result = IssueSchema.parse(issue);
    expect(result.assignedTo).toEqual({
      type: "team",
      id: "123",
      name: "Backend Team",
    });
  });
});

describe("EventSchema", () => {
  it("should parse a standard error event", () => {
    const errorEvent = {
      id: "abc123",
      title: "TypeError: Cannot read property 'x'",
      message: "Cannot read property 'x' of undefined",
      platform: "javascript",
      type: "error",
      entries: [
        {
          type: "exception",
          data: {
            values: [
              {
                type: "TypeError",
                value: "Cannot read property 'x' of undefined",
                stacktrace: {
                  frames: [],
                },
              },
            ],
          },
        },
      ],
      contexts: {},
      tags: [
        { key: "environment", value: "production" },
        { key: "level", value: "error" },
      ],
      culprit: "app.js",
      dateCreated: "2025-01-01T00:00:00Z",
    };

    const result = EventSchema.parse(errorEvent);
    expect(result.type).toBe("error");
  });

  it("should parse a regressed performance event (generic type)", () => {
    // This is the actual event structure from a regressed performance issue
    const regressedEvent = {
      id: "a6251c18f0194b8e8158518b8ee99545",
      groupID: "6898891101",
      eventID: "a6251c18f0194b8e8158518b8ee99545",
      projectID: "4509062593708032",
      size: 547,
      entries: [], // Performance regression events have no entries
      dist: null,
      message: "",
      title: "Endpoint Regression",
      location: null,
      user: null,
      contexts: {},
      sdk: null,
      context: {},
      packages: {},
      type: "generic", // Key difference - performance issues use "generic" type
      metadata: {
        title: "Endpoint Regression",
      },
      tags: [
        { key: "level", value: "info" },
        { key: "transaction", value: "POST /oauth/token" },
      ],
      platform: "python",
      dateReceived: "2025-11-18T06:01:22.186680Z",
      errors: [],
      occurrence: {
        id: "ae3754a99b294006b8d13ad59bb84d0f",
        projectId: 4509062593708032,
        eventId: "a6251c18f0194b8e8158518b8ee99545",
        fingerprint: ["ddf744fc1a47831ed53d9a489160fa7a"],
        issueTitle: "Endpoint Regression",
        subtitle: "Increased from 909.77ms to 1711.36ms (P95)",
        resourceId: null,
        evidenceData: {
          absolutePercentageChange: 1.8810815660491678,
          aggregateRange1: 909.7721153846148,
          aggregateRange2: 1711.3555555555554,
          breakpoint: 1763416800,
          change: "regression",
          dataEnd: 1763488800,
          dataStart: 1762279200,
          project: "4509062593708032",
          requestEnd: 1763488800,
          requestStart: 1763229600,
          transaction: "POST /oauth/token",
          trendDifference: 801.5834401709405,
          trendPercentage: 1.8810815660491678,
          unweightedPValue: 0.0014395802,
          unweightedTValue: -4.5231295109262515,
        },
        evidenceDisplay: [
          {
            name: "Regression",
            value:
              "POST /oauth/token duration increased from 909.77ms to 1711.36ms (P95)",
            important: true,
          },
          {
            name: "Transaction",
            value: "POST /oauth/token",
            important: true,
          },
        ],
        type: 1018,
        detectionTime: 1763445680.827214,
        level: "info",
        culprit: "POST /oauth/token",
        priority: 50,
        assignee: null,
      },
      _meta: {
        entries: {},
        message: null,
        user: null,
        contexts: null,
        sdk: null,
        context: null,
        packages: null,
        tags: {},
      },
      crashFile: null,
      culprit: "POST /oauth/token",
      dateCreated: "2025-11-18T06:01:20Z",
      fingerprints: ["d41d8cd98f00b204e9800998ecf8427e"],
      groupingConfig: {
        id: "newstyle:2023-01-11",
        enhancements:
          "KLUv_SAd6QAAkwORuGFsbC1wbGF0Zm9ybXM6MjAyMy0wMS0xMZA#KLUv_SAd6QAAkwORuGFsbC1wbGF0Zm9ybXM6MjAyMy0wMS0xMZA#KLUv_SAd6QAAkwORuGFsbC1wbGF0Zm9ybXM6MjAyMy0wMS0xMZA",
      },
      release: null,
      userReport: null,
      sdkUpdates: [],
      resolvedWith: [],
      nextEventID: null,
      previousEventID: "65d7c166833945efad0a4d38a4fd3665",
    };

    // This should not throw - the UnknownEventSchema should handle "generic" type
    const result = EventSchema.parse(regressedEvent);

    expect(result.type).toBe("generic");
    expect(result.title).toBe("Endpoint Regression");
  });

  it("should parse a transaction event", () => {
    const transactionEvent = {
      id: "xyz789",
      title: "GET /api/users",
      message: null,
      platform: "python",
      type: "transaction",
      entries: [],
      contexts: {
        trace: {
          type: "trace",
          trace_id: "abc123",
        },
      },
      tags: [{ key: "transaction", value: "GET /api/users" }],
      occurrence: null,
    };

    const result = EventSchema.parse(transactionEvent);
    expect(result.type).toBe("transaction");
  });
});
