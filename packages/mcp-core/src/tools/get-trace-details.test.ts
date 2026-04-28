import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import {
  mswServer,
  traceMetaFixture,
  traceMetaWithNullsFixture,
  traceFixture,
  traceMixedFixture,
} from "@sentry/mcp-server-mocks";
import getTraceDetails from "./get-trace-details.js";

const originalOpenAIApiKey = process.env.OPENAI_API_KEY;
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
const originalEmbeddedAgentProvider = process.env.EMBEDDED_AGENT_PROVIDER;

/** Register the same handler on sentry.io and us.sentry.io (org fixture resolves region). */
function httpGetRegional(
  sentryIoUrl: string,
  resolver: Parameters<typeof http.get>[1],
  options?: Parameters<typeof http.get>[2],
) {
  const usUrl = sentryIoUrl.replace(
    /^https:\/\/sentry\.io\b/,
    "https://us.sentry.io",
  );
  return [
    http.get(sentryIoUrl, resolver, options),
    http.get(usUrl, resolver, options),
  ];
}

function buildTraceSpan({
  description = "Synthetic span",
  eventId,
  spanId,
}: {
  description?: string;
  eventId: string;
  spanId: string;
}) {
  return {
    children: [],
    description,
    duration: 25,
    event_id: eventId,
    op: "task",
    project_slug: "mcp-server",
    span_id: spanId,
  };
}

describe("get_trace_details", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    Reflect.deleteProperty(process.env, "EMBEDDED_AGENT_PROVIDER");
  });

  afterAll(() => {
    if (originalOpenAIApiKey === undefined) {
      Reflect.deleteProperty(process.env, "OPENAI_API_KEY");
    } else {
      process.env.OPENAI_API_KEY = originalOpenAIApiKey;
    }

    if (originalAnthropicApiKey === undefined) {
      Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
    }

    if (originalEmbeddedAgentProvider === undefined) {
      Reflect.deleteProperty(process.env, "EMBEDDED_AGENT_PROVIDER");
    } else {
      process.env.EMBEDDED_AGENT_PROVIDER = originalEmbeddedAgentProvider;
    }
  });

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
            ├─ GET https://us.sentry.io/api/0/projects/example-org/owner-web/ [a408acaf · http.client · 997ms]
            │  └─ /api/0/projects/{organization_id_or_slug}/{project_id_or_slug}/ [a6bfd174 · http.server · 920ms]
            │     └─ getsentry.middleware.HealthCheck.__call__ [bf0014be · middleware.django · 919ms]
            │        └─ csp.middleware.CSPMiddleware.__call__ [8c708492 · middleware.django · 919ms]
            │           └─ sentry.middleware.health.HealthCheck.__call__ [b7566e36 · middleware.django · 919ms]
            │              └─ sentry.middleware.security.SecurityHeadersMiddleware.__call__ [81e527b7 · middleware.django · 919ms]
            │                 └─ sentry.middleware.env.SentryEnvMiddleware.__call__ [a9894194 · middleware.django · 919ms]
            │                    └─ sentry.middleware.proxy.SetRemoteAddrFromForwardedFor.__call__ [bb0856e3 · middleware.django · 919ms]
            ├─ GET https://us.sentry.io/api/0/organizations/example-org/events/ [b4abfe5e · http.client · 1482ms]
            │  └─ /api/0/organizations/{organization_id_or_slug}/events/ [99a97a1d · http.server · 1408ms]
            │     └─ getsentry.middleware.HealthCheck.__call__ [86817c36 · middleware.django · 1407ms]
            │        └─ csp.middleware.CSPMiddleware.__call__ [8d416251 · middleware.django · 1407ms]
            │           └─ sentry.middleware.health.HealthCheck.__call__ [af51b6d3 · middleware.django · 1406ms]
            │              └─ sentry.middleware.security.SecurityHeadersMiddleware.__call__ [b3c88b6c · middleware.django · 1405ms]
            │                 └─ sentry.middleware.env.SentryEnvMiddleware.__call__ [978bf5fd · middleware.django · 1405ms]
            │                    └─ sentry.middleware.proxy.SetRemoteAddrFromForwardedFor.__call__ [bef93ba9 · middleware.django · 1405ms]
            ├─ POST https://api.openai.com/v1/chat/completions [ad0f7c48 · http.client · 1708ms]
            ├─ GET https://us.sentry.io/api/0/organizations/example-org/trace-items/attributes/ [9585e3d3 · http.client · 260ms]
            │  └─ /api/0/organizations/{organization_id_or_slug}/trace-items/attributes/ [bb1b31d0 · http.server · 197ms]
            │     └─ getsentry.middleware.HealthCheck.__call__ [b36091b7 · middleware.django · 196ms]
            │        └─ csp.middleware.CSPMiddleware.__call__ [9071e740 · middleware.django · 196ms]
            │           └─ sentry.middleware.health.HealthCheck.__call__ [b2d4f408 · middleware.django · 195ms]
            │              └─ sentry.middleware.security.SecurityHeadersMiddleware.__call__ [b2c58778 · middleware.django · 195ms]
            │                 └─ sentry.middleware.env.SentryEnvMiddleware.__call__ [9cf75852 · middleware.django · 195ms]
            │                    └─ sentry.middleware.proxy.SetRemoteAddrFromForwardedFor.__call__ [96c0d21b · middleware.django · 195ms]
            ├─ GET https://us.sentry.io/api/0/organizations/example-org/trace-items/attributes/ [b6665933 · http.client · 260ms]
            │  └─ /api/0/organizations/{organization_id_or_slug}/trace-items/attributes/ [83477467 · http.server · 190ms]
            │     └─ getsentry.middleware.HealthCheck.__call__ [93b01ee4 · middleware.django · 189ms]
            │        └─ csp.middleware.CSPMiddleware.__call__ [83e2bf98 · middleware.django · 189ms]
            │           └─ sentry.middleware.health.HealthCheck.__call__ [8dc6d54d · middleware.django · 189ms]
            │              └─ sentry.middleware.security.SecurityHeadersMiddleware.__call__ [bf7cae0e · middleware.django · 188ms]
            │                 └─ sentry.middleware.env.SentryEnvMiddleware.__call__ [a4131a6a · middleware.django · 188ms]
            │                    └─ sentry.middleware.proxy.SetRemoteAddrFromForwardedFor.__call__ [865694d5 · middleware.django · 188ms]
            └─ POST https://api.openai.com/v1/chat/completions [b0794450 · http.client · 738ms]

      *Overview shows 35 of 112 spans.*

      ## View Full Trace

      **Sentry URL**: https://sentry-mcp-evals.sentry.io/explore/traces/trace/a4d1aae7216b47ff8117cf4e09ce9d0a

      ## Next Steps

      - **Search spans**: \`search_events(organizationSlug='sentry-mcp-evals', query='show more spans from trace a4d1aae7216b47ff8117cf4e09ce9d0a')\`
      - **Search errors**: \`search_events(organizationSlug='sentry-mcp-evals', query='show error events from trace a4d1aae7216b47ff8117cf4e09ce9d0a')\`
      - **Search logs**: \`search_events(organizationSlug='sentry-mcp-evals', query='show logs from trace a4d1aae7216b47ff8117cf4e09ce9d0a')\`"
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
    expect(result).toContain(
      "**Search spans**: `search_events(organizationSlug='sentry-mcp-evals', query='show more spans from trace a4d1aae7216b47ff8117cf4e09ce9d0a')`",
    );
  });

  it("falls back to direct search_events guidance when agent search is unavailable", async () => {
    Reflect.deleteProperty(process.env, "OPENAI_API_KEY");
    Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    Reflect.deleteProperty(process.env, "EMBEDDED_AGENT_PROVIDER");

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
      "**Search spans**: `search_events(organizationSlug='sentry-mcp-evals', dataset='spans', query='trace:a4d1aae7216b47ff8117cf4e09ce9d0a')`",
    );
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

  it("returns trace details under an active project constraint", async () => {
    mswServer.use(
      ...httpGetRegional(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/frontend/",
        () => {
          throw new Error("getProject should not be called for trace lookups");
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
          projectSlug: "frontend",
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    expect(result).toContain("**Total Spans**: 112");
    expect(result).not.toContain("**Scope**:");
  });

  it("handles empty trace response", async () => {
    mswServer.use(
      ...httpGetRegional(
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
      ...httpGetRegional(
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
      ...httpGetRegional(
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
      ...httpGetRegional(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/trace-meta/a4d1aae7216b47ff8117cf4e09ce9d0a/",
        () => {
          return HttpResponse.json(traceMetaWithNullsFixture);
        },
      ),
      ...httpGetRegional(
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
      ...httpGetRegional(
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
      ...httpGetRegional(
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
         │  └─ POST https://api.openai.com/v1/chat/completions [ad0f7c48 · http.client · 1708ms]
         └─ GET https://us.sentry.io/api/0/organizations/example-org/events/ [b4abfe5e · http.client · 1482ms]
            └─ /api/0/organizations/{organization_id_or_slug}/events/ [99a97a1d · http.server · 1408ms]

      *Overview shows 4 of 4 spans.*

      ## View Full Trace

      **Sentry URL**: https://sentry-mcp-evals.sentry.io/explore/traces/trace/b4d1aae7216b47ff8117cf4e09ce9d0b

      ## Next Steps

      - **Search spans**: \`search_events(organizationSlug='sentry-mcp-evals', query='show more spans from trace b4d1aae7216b47ff8117cf4e09ce9d0b')\`
      - **Search errors**: \`search_events(organizationSlug='sentry-mcp-evals', query='show error events from trace b4d1aae7216b47ff8117cf4e09ce9d0b')\`
      - **Search logs**: \`search_events(organizationSlug='sentry-mcp-evals', query='show logs from trace b4d1aae7216b47ff8117cf4e09ce9d0b')\`"
    `);
  });

  it("fetches enough spans to resolve focused spans in large traces", async () => {
    const traceId = "c4d1aae7216b47ff8117cf4e09ce9d0c";
    const spanId = "00000000000007d0";

    mswServer.use(
      ...httpGetRegional(
        `https://sentry.io/api/0/organizations/sentry-mcp-evals/trace-meta/${traceId}/`,
        () =>
          HttpResponse.json({
            logs: 0,
            errors: 0,
            performance_issues: 0,
            span_count: 2000,
            transaction_child_count_map: [],
            span_count_map: {},
          }),
      ),
      ...httpGetRegional(
        `https://sentry.io/api/0/organizations/sentry-mcp-evals/trace/${traceId}/`,
        ({ request }) => {
          const limit = Number(
            new URL(request.url).searchParams.get("limit") ?? "0",
          );

          if (limit < 2000) {
            return HttpResponse.json([]);
          }

          return HttpResponse.json([
            buildTraceSpan({
              eventId: "1".repeat(32),
              spanId,
              description: "Late span in a large trace",
            }),
          ]);
        },
      ),
    );

    const result = await getTraceDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        traceId,
        spanId,
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

    expect(result).toContain(`# Span \`${spanId}\` in Trace \`${traceId}\``);
    expect(result).toContain("Late span in a large trace");
    expect(result).toContain("**Trace Total Spans**: 2000");
  });

  it("reports a partial fetch when a focused span is missing from a large trace", async () => {
    const traceId = "d4d1aae7216b47ff8117cf4e09ce9d0d";
    const fetchedTrace = Array.from({ length: 10000 }, (_, index) =>
      buildTraceSpan({
        eventId: index.toString(16).padStart(32, "0"),
        spanId: index.toString(16).padStart(16, "0"),
      }),
    );

    mswServer.use(
      ...httpGetRegional(
        `https://sentry.io/api/0/organizations/sentry-mcp-evals/trace-meta/${traceId}/`,
        () =>
          HttpResponse.json({
            logs: 0,
            errors: 0,
            performance_issues: 0,
            span_count: 20000,
            transaction_child_count_map: [],
            span_count_map: {},
          }),
      ),
      ...httpGetRegional(
        `https://sentry.io/api/0/organizations/sentry-mcp-evals/trace/${traceId}/`,
        () => HttpResponse.json(fetchedTrace),
      ),
    );

    await expect(
      getTraceDetails.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          traceId,
          spanId: "ffffffffffffffff",
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
    ).rejects.toThrow(
      /was not found in the fetched portion of trace .*Fetched 10000 of 20000 spans\./,
    );
  }, 15_000);

  it("renders a focused span with child snapshot and attributes", async () => {
    mswServer.use(
      ...httpGetRegional(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/trace-meta/b4d1aae7216b47ff8117cf4e09ce9d0b/",
        () =>
          HttpResponse.json({
            logs: 0,
            errors: 2,
            performance_issues: 0,
            span_count: 4,
            transaction_child_count_map: [],
            span_count_map: {},
          }),
      ),
      ...httpGetRegional(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/trace/b4d1aae7216b47ff8117cf4e09ce9d0b/",
        () => HttpResponse.json(traceMixedFixture),
      ),
    );

    const result = await getTraceDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        traceId: "b4d1aae7216b47ff8117cf4e09ce9d0b",
        spanId: "aa8e7f3384ef4ff5",
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
      "# Span \`aa8e7f3384ef4ff5\` in Trace \`b4d1aae7216b47ff8117cf4e09ce9d0b\` in **sentry-mcp-evals**

      ## Summary

      **Project**: mcp-server
      **Operation**: function
      **Description**: tools/call search_events
      **Duration**: 5203ms
      **Exclusive Time**: 3495ms
      **Status**: unknown
      **Parent Span ID**: None (root span)
      **Child Spans**: 1
      **Descendant Spans**: 1
      **Errors**: 0
      **Event Type**: span
      **SDK**: sentry.javascript.bun
      **Trace Total Spans**: 4

      ## Child Snapshot

      tools/call search_events [aa8e7f33 · function · 5203ms]
         └─ POST https://api.openai.com/v1/chat/completions [ad0f7c48 · http.client · 1708ms]

      *Child snapshot shows 1 of 1 descendant spans.*

      ## View Full Span

      **Sentry URL**: https://sentry-mcp-evals.sentry.io/explore/traces/trace/b4d1aae7216b47ff8117cf4e09ce9d0b?node=span-aa8e7f3384ef4ff5

      ## Attributes

      ### Core Fields

      \`\`\`json
      {
        "description": "tools/call search_events",
        "duration": 5203,
        "end_timestamp": 1713805463.608875,
        "event_id": "aa8e7f3384ef4ff5850ba966b29ed10d",
        "exclusive_time": 3495,
        "hash": "4ed30c7c-4fae-4c79-b2f1-be95c24e7b04",
        "is_segment": true,
        "op": "function",
        "organization": null,
        "parent_span_id": null,
        "profile_id": "",
        "profiler_id": "",
        "project_id": 4509109107622913,
        "project_slug": "mcp-server",
        "same_process_as_parent": true,
        "sdk_name": "sentry.javascript.bun",
        "span_id": "aa8e7f3384ef4ff5",
        "start_timestamp": 1713805458.405616,
        "status": null,
        "timestamp": 1713805463.608875,
        "trace": "b4d1aae7216b47ff8117cf4e09ce9d0b",
        "transaction_id": "aa8e7f3384ef4ff5850ba966b29ed10d"
      }
      \`\`\`

      ### Measurements

      \`\`\`json
      {}
      \`\`\`

      ### Tags

      \`\`\`json
      {
        "ai.input_messages": "1",
        "ai.model_id": "gpt-4o-2024-08-06",
        "ai.pipeline.name": "search_events",
        "ai.response.finish_reason": "stop",
        "ai.streaming": "false",
        "ai.total_tokens.used": "435",
        "server_name": "mcp-server"
      }
      \`\`\`

      ### Data

      \`\`\`json
      {}
      \`\`\`

      ### Additional Attributes

      \`\`\`json
      {}
      \`\`\`

      ### Errors

      \`\`\`json
      []
      \`\`\`

      ### Occurrences

      \`\`\`json
      []
      \`\`\`

      ## Next Steps

      - **Search spans**: \`search_events(organizationSlug='sentry-mcp-evals', query='show sibling spans or the rest of trace b4d1aae7216b47ff8117cf4e09ce9d0b')\`
      - **Search errors**: \`search_events(organizationSlug='sentry-mcp-evals', query='show error events from trace b4d1aae7216b47ff8117cf4e09ce9d0b')\`
      - **Search logs**: \`search_events(organizationSlug='sentry-mcp-evals', query='show logs from trace b4d1aae7216b47ff8117cf4e09ce9d0b')\`"
    `);
  });
});
