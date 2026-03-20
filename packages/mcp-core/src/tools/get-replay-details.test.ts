import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer, replayDetailsFixture } from "@sentry/mcp-server-mocks";
import getReplayDetails from "./get-replay-details.js";
import { getServerContext } from "../test-setup.js";

const replayIssueAutofixState = {
  autofix: {
    run_id: 1,
    request: {},
    updated_at: "2025-04-07T12:05:30.000Z",
    status: "COMPLETED" as const,
    steps: [
      {
        type: "root_cause_analysis" as const,
        key: "root_cause_analysis",
        index: 0,
        status: "COMPLETED" as const,
        title: "Root Cause Analysis",
        output_stream: null,
        progress: [],
        causes: [
          {
            description:
              "The issue is triggered when the tool registry registers list_organizations twice during startup.",
            id: 0,
            root_cause_reproduction: [],
          },
        ],
      },
    ],
  },
};

describe("get_replay_details", () => {
  it("loads replay details from replayUrl", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/autofix/",
        () => HttpResponse.json(replayIssueAutofixState),
        { once: true },
      ),
    );

    const result = await getReplayDetails.handler(
      {
        replayUrl: `https://sentry-mcp-evals.sentry.io/replays/${replayDetailsFixture.id}/`,
      },
      getServerContext(),
    );

    expect(result).toMatchInlineSnapshot(`
      "# Replay 7e07485f-12f9-416b-8b14-26260799b51f in **sentry-mcp-evals**

      ## Summary

      - **Replay URL**: https://sentry-mcp-evals.sentry.io/replays/7e07485f-12f9-416b-8b14-26260799b51f/
      - **Started**: 2025-04-07T12:00:00.000Z
      - **Finished**: 2025-04-07T12:05:00.000Z
      - **Duration**: 5m
      - **Archived**: No
      - **Environment**: production
      - **Platform**: javascript
      - **Browser**: Chrome 123.0
      - **User**: Taylor Example
      - **URLs**: /login, /checkout
      - **Device**: MacBook Pro
      - **Signal Counts**: errors=1, warnings=2, infos=3, dead_clicks=1, rage_clicks=0, segments=2

      ## Events

      - T+0s · \`page.view\` · href=https://example.com/login
      - T+10s · \`navigation.navigate\` · description=https://example.com/checkout · duration_ms=710
      - T+20s · \`ui.click\` · message="Clicked submit order"
      - metadata · \`error\` · event_id=7ca573c0f4814912aaa9bdc77d1a7d51 · issue_id=CLOUDFLARE-MCP-41 · title="Error: Tool list_organizations is already registered"
      - metadata · \`dead_click\` · count=1
      - metadata · \`warning\` · count=2
      - metadata · \`info\` · count=3

      ## Related

      ### Error Event \`7ca573c0f4814912aaa9bdc77d1a7d51\`
      **Issue ID**: CLOUDFLARE-MCP-41
      **Summary**: Error: Tool list_organizations is already registered
      **Status**: unresolved
      **Cached Seer Summary**: The issue is triggered when the tool registry registers list_organizations twice during startup.
      **Next Step**: \`get_issue_details(organizationSlug='sentry-mcp-evals', eventId='7ca573c0f4814912aaa9bdc77d1a7d51')\`
      **Root Cause Analysis**: \`analyze_issue_with_seer(organizationSlug='sentry-mcp-evals', issueId='CLOUDFLARE-MCP-41')\`

      ### Trace \`a4d1aae7216b47ff8117cf4e09ce9d0a\`
      **High-level Stats**: 112 spans, 0 errors, 0 performance issues, 0 logs
      **Next Step**: \`get_trace_details(organizationSlug='sentry-mcp-evals', traceId='a4d1aae7216b47ff8117cf4e09ce9d0a')\`
      "
    `);
  });

  it("includes next-step guidance when only raw replay IDs are available", async () => {
    const replayWithUnresolvedError = {
      ...replayDetailsFixture,
      error_ids: ["replay-only-event-id"],
    };

    mswServer.use(
      http.get(
        `https://sentry.io/api/0/organizations/sentry-mcp-evals/replays/${replayDetailsFixture.id}/`,
        () => HttpResponse.json({ data: replayWithUnresolvedError }),
        { once: true },
      ),
    );

    const result = await getReplayDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        replayId: replayDetailsFixture.id,
      },
      getServerContext(),
    );

    expect(result).toContain("### Error Event `replay-only-event-id`");
    expect(result).toContain(
      "`get_issue_details(organizationSlug='sentry-mcp-evals', eventId='replay-only-event-id')`",
    );
    expect(result).toContain("### Trace `a4d1aae7216b47ff8117cf4e09ce9d0a`");
    expect(result).toContain(
      "`get_trace_details(organizationSlug='sentry-mcp-evals', traceId='a4d1aae7216b47ff8117cf4e09ce9d0a')`",
    );
  });

  it("skips segment-derived timeline for archived replays", async () => {
    const archivedReplay = {
      ...replayDetailsFixture,
      is_archived: true,
    };

    mswServer.use(
      http.get(
        `https://sentry.io/api/0/organizations/sentry-mcp-evals/replays/${archivedReplay.id}/`,
        () => HttpResponse.json({ data: archivedReplay }),
        { once: true },
      ),
    );

    const result = await getReplayDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        replayId: archivedReplay.id,
      },
      getServerContext(),
    );

    expect(result).toMatchInlineSnapshot(`
      "# Replay 7e07485f-12f9-416b-8b14-26260799b51f in **sentry-mcp-evals**

      ## Summary

      - **Replay URL**: https://sentry-mcp-evals.sentry.io/replays/7e07485f-12f9-416b-8b14-26260799b51f/
      - **Started**: 2025-04-07T12:00:00.000Z
      - **Finished**: 2025-04-07T12:05:00.000Z
      - **Duration**: 5m
      - **Archived**: Yes
      - **Environment**: production
      - **Platform**: javascript
      - **Browser**: Chrome 123.0
      - **User**: Taylor Example
      - **URLs**: /login, /checkout
      - **Device**: MacBook Pro
      - **Signal Counts**: errors=1, warnings=2, infos=3, dead_clicks=1, rage_clicks=0, segments=2

      ## Events

      - \`recording_segments\` · status=archived
      - metadata · \`error\` · event_id=7ca573c0f4814912aaa9bdc77d1a7d51 · issue_id=CLOUDFLARE-MCP-41 · title="Error: Tool list_organizations is already registered"
      - metadata · \`dead_click\` · count=1
      - metadata · \`warning\` · count=2
      - metadata · \`info\` · count=3

      ## Related

      ### Error Event \`7ca573c0f4814912aaa9bdc77d1a7d51\`
      **Issue ID**: CLOUDFLARE-MCP-41
      **Summary**: Error: Tool list_organizations is already registered
      **Status**: unresolved
      **Next Step**: \`get_issue_details(organizationSlug='sentry-mcp-evals', eventId='7ca573c0f4814912aaa9bdc77d1a7d51')\`
      **Root Cause Analysis**: \`analyze_issue_with_seer(organizationSlug='sentry-mcp-evals', issueId='CLOUDFLARE-MCP-41')\`

      ### Trace \`a4d1aae7216b47ff8117cf4e09ce9d0a\`
      **High-level Stats**: 112 spans, 0 errors, 0 performance issues, 0 logs
      **Next Step**: \`get_trace_details(organizationSlug='sentry-mcp-evals', traceId='a4d1aae7216b47ff8117cf4e09ce9d0a')\`
      "
    `);
  });

  it("degrades gracefully when segment fetch fails", async () => {
    mswServer.use(
      http.get(
        `https://sentry.io/api/0/organizations/sentry-mcp-evals/replays/${replayDetailsFixture.id}/`,
        () => HttpResponse.json({ data: replayDetailsFixture }),
        { once: true },
      ),
      http.get(
        `https://sentry.io/api/0/projects/sentry-mcp-evals/${replayDetailsFixture.project_id}/replays/${replayDetailsFixture.id}/recording-segments/`,
        () =>
          HttpResponse.json(
            { detail: "Replay recording segment not found." },
            { status: 404 },
          ),
        { once: true },
      ),
    );

    const result = await getReplayDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        replayId: replayDetailsFixture.id,
      },
      getServerContext(),
    );

    expect(result).toMatchInlineSnapshot(`
      "# Replay 7e07485f-12f9-416b-8b14-26260799b51f in **sentry-mcp-evals**

      ## Summary

      - **Replay URL**: https://sentry-mcp-evals.sentry.io/replays/7e07485f-12f9-416b-8b14-26260799b51f/
      - **Started**: 2025-04-07T12:00:00.000Z
      - **Finished**: 2025-04-07T12:05:00.000Z
      - **Duration**: 5m
      - **Archived**: No
      - **Environment**: production
      - **Platform**: javascript
      - **Browser**: Chrome 123.0
      - **User**: Taylor Example
      - **URLs**: /login, /checkout
      - **Device**: MacBook Pro
      - **Signal Counts**: errors=1, warnings=2, infos=3, dead_clicks=1, rage_clicks=0, segments=2

      ## Events

      - \`recording_segments\` · status=unavailable · detail="Replay recording segment not found."
      - metadata · \`error\` · event_id=7ca573c0f4814912aaa9bdc77d1a7d51 · issue_id=CLOUDFLARE-MCP-41 · title="Error: Tool list_organizations is already registered"
      - metadata · \`dead_click\` · count=1
      - metadata · \`warning\` · count=2
      - metadata · \`info\` · count=3

      ## Related

      ### Error Event \`7ca573c0f4814912aaa9bdc77d1a7d51\`
      **Issue ID**: CLOUDFLARE-MCP-41
      **Summary**: Error: Tool list_organizations is already registered
      **Status**: unresolved
      **Next Step**: \`get_issue_details(organizationSlug='sentry-mcp-evals', eventId='7ca573c0f4814912aaa9bdc77d1a7d51')\`
      **Root Cause Analysis**: \`analyze_issue_with_seer(organizationSlug='sentry-mcp-evals', issueId='CLOUDFLARE-MCP-41')\`

      ### Trace \`a4d1aae7216b47ff8117cf4e09ce9d0a\`
      **High-level Stats**: 112 spans, 0 errors, 0 performance issues, 0 logs
      **Next Step**: \`get_trace_details(organizationSlug='sentry-mcp-evals', traceId='a4d1aae7216b47ff8117cf4e09ce9d0a')\`
      "
    `);
  });

  it("throws for invalid direct input", async () => {
    await expect(
      getReplayDetails.handler({}, getServerContext()),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[UserInputError: Provide either \`replayUrl\` or both \`organizationSlug\` and \`replayId\`.]`,
    );
  });

  it("does not repeat explicit payload fields in generic replay events", async () => {
    mswServer.use(
      http.get(
        `https://sentry.io/api/0/projects/sentry-mcp-evals/${replayDetailsFixture.project_id}/replays/${replayDetailsFixture.id}/recording-segments/`,
        () =>
          HttpResponse.json([
            [
              {
                type: 5,
                timestamp: 1744027205000,
                data: {
                  tag: "console",
                  payload: {
                    message: "Payment request failed",
                    description: "POST /api/orders returned 500",
                    category: "network",
                    type: "error",
                    endpoint: "/api/orders",
                    status: 500,
                  },
                },
              },
            ],
          ]),
        { once: true },
      ),
    );

    const result = await getReplayDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        replayId: replayDetailsFixture.id,
      },
      getServerContext(),
    );

    expect(result).toContain(
      '- T+0s · `console` · message="Payment request failed" · description="POST /api/orders returned 500" · category="network" · type="error" · payload="endpoint=/api/orders, status=500"',
    );
    expect(result).not.toContain('payload="message=Payment request failed');
    expect(result).not.toContain(
      'payload="description=POST /api/orders returned 500',
    );
  });
});
