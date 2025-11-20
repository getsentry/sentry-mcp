import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import {
  mswServer,
  traceMetaFixture,
  traceMetaWithNullsFixture,
  traceFixture,
  traceMixedFixture,
} from "@sentry/mcp-server-mocks";
import getTraceDetails from "./get-trace-details.js";

describe("get_trace_details", () => {
  it("serializes with valid trace ID", async () => {
    const result = await getTraceDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        traceId: "a4d1aae7216b47ff8117cf4e09ce9d0a",
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Trace \`a4d1aae7216b47ff8117cf4e09ce9d0a\` in **sentry-mcp-evals**

      ## Summary

      **Total Spans**: 112
      **Errors**: 0
      **Performance Issues**: 0
      **Logs**: 0

      ## Operation Breakdown

      - **db**: 90 spans (avg: 16ms, p95: 13ms)
      - **feature.flagpole.batch_has**: 30 spans (avg: 18ms, p95: 32ms)
      - **function**: 14 spans (avg: 303ms, p95: 1208ms)
      - **http.client**: 2 spans (avg: 1223ms, p95: 1708ms)
      - **other**: 1 spans (avg: 6ms, p95: 6ms)

      ## Overview

      trace [a4d1aae7]
         └─ tools/call search_events [aa8e7f33 · 5203ms]
            ├─ POST https://api.openai.com/v1/chat/completions [ad0f7c48 · http.client · 1708ms]
            └─ GET https://us.sentry.io/api/0/organizations/example-org/events/ [b4abfe5e · http.client · 1482ms]
               └─ /api/0/organizations/{organization_id_or_slug}/events/ [99a97a1d · http.server · 1408ms]

      *Note: This shows a subset of spans. View the full trace for complete details.*

      ## View Full Trace

      **Sentry URL**: https://sentry-mcp-evals.sentry.io/explore/traces/trace/a4d1aae7216b47ff8117cf4e09ce9d0a

      ## Find Related Events

      Use this search query to find all events in this trace:
      \`\`\`
      trace:a4d1aae7216b47ff8117cf4e09ce9d0a
      \`\`\`

      You can use this query with the \`search_events\` tool to get detailed event data from this trace."
    `);
  });

  it("serializes with fixed stats period", async () => {
    const result = await getTraceDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        traceId: "a4d1aae7216b47ff8117cf4e09ce9d0a",
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toContain(
      "Trace `a4d1aae7216b47ff8117cf4e09ce9d0a` in **sentry-mcp-evals**",
    );
    expect(result).toContain("**Total Spans**: 112");
    expect(result).toContain("trace:a4d1aae7216b47ff8117cf4e09ce9d0a");
  });

  it("handles trace not found error", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry/trace-meta/nonexistent/",
        () => {
          return new HttpResponse(null, { status: 404 });
        },
      ),
    );

    await expect(
      getTraceDetails.handler(
        {
          organizationSlug: "sentry",
          traceId: "nonexistent",
          regionUrl: null,
        },
        {
          constraints: {
            organizationSlug: null,
          },
          accessToken: "access-token",
          userId: "1",
        },
      ),
    ).rejects.toThrow();
  });

  it("validates trace ID format", async () => {
    await expect(
      getTraceDetails.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          traceId: "invalid-trace-id", // Too short, not hex
          regionUrl: null,
        },
        {
          constraints: {
            organizationSlug: null,
          },
          accessToken: "access-token",
          userId: "1",
        },
      ),
    ).rejects.toThrow("Trace ID must be a 32-character hexadecimal string");
  });

  it("handles empty trace response", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/trace-meta/a4d1aae7216b47ff8117cf4e09ce9d0a/",
        () => {
          return HttpResponse.json({
            logs: 0,
            errors: 0,
            performance_issues: 0,
            span_count: 0,
            transaction_child_count_map: [],
            span_count_map: {},
          });
        },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/trace/a4d1aae7216b47ff8117cf4e09ce9d0a/",
        () => {
          return HttpResponse.json([]);
        },
      ),
    );

    const result = await getTraceDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        traceId: "a4d1aae7216b47ff8117cf4e09ce9d0a",
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    expect(result).toContain("**Total Spans**: 0");
    expect(result).toContain("**Errors**: 0");
    expect(result).toContain("## Summary");
    expect(result).not.toContain("## Operation Breakdown");
    expect(result).not.toContain("## Overview");
  });

  it("handles API error gracefully", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/trace-meta/a4d1aae7216b47ff8117cf4e09ce9d0a/",
        () => {
          return new HttpResponse(
            JSON.stringify({ detail: "Organization not found" }),
            { status: 404 },
          );
        },
      ),
    );

    await expect(
      getTraceDetails.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          traceId: "a4d1aae7216b47ff8117cf4e09ce9d0a",
          regionUrl: null,
        },
        {
          constraints: {
            organizationSlug: null,
          },
          accessToken: "access-token",
          userId: "1",
        },
      ),
    ).rejects.toThrow();
  });

  it("works with regional URL override", async () => {
    mswServer.use(
      http.get(
        "https://us.sentry.io/api/0/organizations/sentry-mcp-evals/trace-meta/a4d1aae7216b47ff8117cf4e09ce9d0a/",
        () => {
          return HttpResponse.json(traceMetaFixture);
        },
      ),
      http.get(
        "https://us.sentry.io/api/0/organizations/sentry-mcp-evals/trace/a4d1aae7216b47ff8117cf4e09ce9d0a/",
        () => {
          return HttpResponse.json(traceFixture);
        },
      ),
    );

    const result = await getTraceDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        traceId: "a4d1aae7216b47ff8117cf4e09ce9d0a",
        regionUrl: "https://us.sentry.io",
      },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    expect(result).toContain(
      "Trace `a4d1aae7216b47ff8117cf4e09ce9d0a` in **sentry-mcp-evals**",
    );
    expect(result).toContain("**Total Spans**: 112");
  });

  it("handles trace meta with null transaction.event_id values", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/trace-meta/a4d1aae7216b47ff8117cf4e09ce9d0a/",
        () => {
          return HttpResponse.json(traceMetaWithNullsFixture);
        },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/trace/a4d1aae7216b47ff8117cf4e09ce9d0a/",
        () => {
          return HttpResponse.json(traceFixture);
        },
      ),
    );

    const result = await getTraceDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        traceId: "a4d1aae7216b47ff8117cf4e09ce9d0a",
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    // The handler should successfully process the response with null values
    expect(result).toContain(
      "Trace `a4d1aae7216b47ff8117cf4e09ce9d0a` in **sentry-mcp-evals**",
    );
    expect(result).toContain("**Total Spans**: 85");
    expect(result).toContain("**Errors**: 2");
    // The null transaction.event_id entries should be handled gracefully
    // and the trace should still be processed successfully
    expect(result).not.toContain("null");
  });

  it("handles mixed span/issue arrays in trace responses", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/trace-meta/b4d1aae7216b47ff8117cf4e09ce9d0b/",
        () => {
          return HttpResponse.json({
            logs: 0,
            errors: 2,
            performance_issues: 0,
            span_count: 4,
            transaction_child_count_map: [],
            span_count_map: {},
          });
        },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/trace/b4d1aae7216b47ff8117cf4e09ce9d0b/",
        () => {
          return HttpResponse.json(traceMixedFixture);
        },
      ),
    );

    const result = await getTraceDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        traceId: "b4d1aae7216b47ff8117cf4e09ce9d0b",
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    expect(result).toMatchInlineSnapshot(`
      "# Trace \`b4d1aae7216b47ff8117cf4e09ce9d0b\` in **sentry-mcp-evals**

      ## Summary

      **Total Spans**: 4
      **Errors**: 2
      **Performance Issues**: 0
      **Logs**: 0

      ## Operation Breakdown

      - **http.client**: 1 spans (avg: 1708ms, p95: 1708ms)
      - **http.server**: 1 spans (avg: 1408ms, p95: 1408ms)

      ## Overview

      trace [b4d1aae7]
         ├─ tools/call search_events [aa8e7f33 · function · 5203ms]
         │  └─ POST https://api.openai.com/v1/chat/completions [aa8e7f33 · http.client · 1708ms]
         └─ GET https://us.sentry.io/api/0/organizations/example-org/events/ [b4abfe5e · http.client · 1482ms]
            └─ /api/0/organizations/{organization_id_or_slug}/events/ [b4abfe5e · http.server · 1408ms]

      *Note: This shows a subset of spans. View the full trace for complete details.*

      ## View Full Trace

      **Sentry URL**: https://sentry-mcp-evals.sentry.io/explore/traces/trace/b4d1aae7216b47ff8117cf4e09ce9d0b

      ## Find Related Events

      Use this search query to find all events in this trace:
      \`\`\`
      trace:b4d1aae7216b47ff8117cf4e09ce9d0b
      \`\`\`

      You can use this query with the \`search_events\` tool to get detailed event data from this trace."
    `);
  });
});
