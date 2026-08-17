import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import {
  mswServer,
  organizationFixture,
  replayDetailsFixture,
} from "@sentry/mcp-server-mocks";
import getReplayDetails, { resolveReplayParams } from "./get-replay-details.js";
import { getServerContext } from "../../test-setup.js";

describe("get_replay_details", () => {
  // NOTE: The Activity snapshots below record known-wrong output. The fixtures
  // now use the event shape the SDK actually emits (`tag: "breadcrumb"` with
  // the meaning in `payload.category`), which the current classifier does not
  // understand: it labels every user action `breadcrumb`, spends the six-event
  // budget on session-boot noise, and drops the console error, the failed
  // checkout request, the rage click, and the dead click entirely.
  //
  // These baselines exist to make the taxonomy fix visible as a diff. See
  // docs/specs/replay-review.md.
  it("loads replay details from replayUrl", async () => {
    const result = await getReplayDetails.handler(
      {
        replayUrl: `https://sentry-mcp-evals.sentry.io/explore/replays/${replayDetailsFixture.id}/`,
      },
      getServerContext(),
    );

    expect(result).toMatchInlineSnapshot(`
      "# Replay 7e07485f-12f9-416b-8b14-26260799b51f in **sentry-mcp-evals**

      ## Summary

      - **Replay URL**: https://sentry-mcp-evals.sentry.io/explore/replays/7e07485f-12f9-416b-8b14-26260799b51f/
      - **Duration**: 5m
      - **Environment**: production
      - **Browser**: Chrome 123.0
      - **OS**: macOS 14.4
      - **User**: Taylor Example
      - **URLs**: /login, /checkout
      - **Device**: MacBook Pro
      - **Release**: frontend@1.2.3
      - **Errors**: 1
      - **Rage Clicks**: 1
      - **Dead Clicks**: 2
      - **Warnings**: 2
      - **Infos**: 3
      - **Recording Segments**: 2
      - **Archived**: No

      ## Activity

      - T+0s · \`page.view\` · href=https://example.com/login
      - T+0s · \`options\` · payload="sessionSampleRate=0.1, errorSampleRate=1"
      - T+1s · \`navigation.navigate\` · description=https://example.com/login · duration_ms=540
      - T+1s · \`resource.script\` · description=https://cdn.example.com/vendor.js
      - T+12s · \`breadcrumb\` · message="body > div#root > form#login > button#sign-in" · category="ui.click" · type="default" · payload="timestamp=1744027212.4"
      - T+13s · \`resource.fetch\` · description=https://example.com/api/login

      ## Related

      - **CLOUDFLARE-MCP-41**: Error: Tool list_organizations is already registered
      - Trace \`a4d1aae7216b47ff8117cf4e09ce9d0a\` (112 spans)

      Use \`get_sentry_resource\` to inspect any issue or trace listed above."
    `);
  });

  it("shows unresolved error events by event ID", async () => {
    const replayWithUnresolvedError = {
      ...replayDetailsFixture,
      error_ids: ["replay-only-event-id"],
    };

    mswServer.use(
      http.get(
        `https://us.sentry.io/api/0/organizations/sentry-mcp-evals/replays/${replayDetailsFixture.id}/`,
        () => HttpResponse.json({ data: replayWithUnresolvedError }),
        { once: true },
      ),
    );

    const result = await getReplayDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        replayId: replayDetailsFixture.id,
        regionUrl: "https://us.sentry.io",
      },
      getServerContext(),
    );

    expect(result).toContain("- Event `replay-only-event-id`");
    expect(result).toContain("Use `get_sentry_resource`");
  });

  it("handles archived replays", async () => {
    const archivedReplay = {
      ...replayDetailsFixture,
      is_archived: true,
    };

    mswServer.use(
      http.get(
        `https://us.sentry.io/api/0/organizations/sentry-mcp-evals/replays/${archivedReplay.id}/`,
        () => HttpResponse.json({ data: archivedReplay }),
        { once: true },
      ),
    );

    const result = await getReplayDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        replayId: archivedReplay.id,
        regionUrl: "https://us.sentry.io",
      },
      getServerContext(),
    );

    expect(result).toMatchInlineSnapshot(`
      "# Replay 7e07485f-12f9-416b-8b14-26260799b51f in **sentry-mcp-evals**

      ## Summary

      - **Replay URL**: https://sentry-mcp-evals.sentry.io/explore/replays/7e07485f-12f9-416b-8b14-26260799b51f/
      - **Duration**: 5m
      - **Environment**: production
      - **Browser**: Chrome 123.0
      - **OS**: macOS 14.4
      - **User**: Taylor Example
      - **URLs**: /login, /checkout
      - **Device**: MacBook Pro
      - **Release**: frontend@1.2.3
      - **Errors**: 1
      - **Rage Clicks**: 1
      - **Dead Clicks**: 2
      - **Warnings**: 2
      - **Infos**: 3
      - **Recording Segments**: 2
      - **Archived**: Yes

      ## Activity

      Recording is archived and not available for playback.

      ## Related

      - **CLOUDFLARE-MCP-41**: Error: Tool list_organizations is already registered
      - Trace \`a4d1aae7216b47ff8117cf4e09ce9d0a\` (112 spans)

      Use \`get_sentry_resource\` to inspect any issue or trace listed above."
    `);
  });

  it("degrades gracefully when segment fetch fails", async () => {
    mswServer.use(
      http.get(
        `https://us.sentry.io/api/0/organizations/sentry-mcp-evals/replays/${replayDetailsFixture.id}/`,
        () => HttpResponse.json({ data: replayDetailsFixture }),
        { once: true },
      ),
      http.get(
        `https://us.sentry.io/api/0/projects/sentry-mcp-evals/${replayDetailsFixture.project_id}/replays/${replayDetailsFixture.id}/recording-segments/`,
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
        regionUrl: "https://us.sentry.io",
      },
      getServerContext(),
    );

    expect(result).toMatchInlineSnapshot(`
      "# Replay 7e07485f-12f9-416b-8b14-26260799b51f in **sentry-mcp-evals**

      ## Summary

      - **Replay URL**: https://sentry-mcp-evals.sentry.io/explore/replays/7e07485f-12f9-416b-8b14-26260799b51f/
      - **Duration**: 5m
      - **Environment**: production
      - **Browser**: Chrome 123.0
      - **OS**: macOS 14.4
      - **User**: Taylor Example
      - **URLs**: /login, /checkout
      - **Device**: MacBook Pro
      - **Release**: frontend@1.2.3
      - **Errors**: 1
      - **Rage Clicks**: 1
      - **Dead Clicks**: 2
      - **Warnings**: 2
      - **Infos**: 3
      - **Recording Segments**: 2
      - **Archived**: No

      ## Activity

      No activity events recorded.

      ## Related

      - **CLOUDFLARE-MCP-41**: Error: Tool list_organizations is already registered
      - Trace \`a4d1aae7216b47ff8117cf4e09ce9d0a\` (112 spans)

      Use \`get_sentry_resource\` to inspect any issue or trace listed above."
    `);
  });

  it("throws for invalid direct input", async () => {
    await expect(
      getReplayDetails.handler({}, getServerContext()),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[UserInputError: Provide either \`replayUrl\` or both \`organizationSlug\` and \`replayId\`.]`,
    );
  });

  it("rejects replay URLs outside the active organization constraint", () => {
    expect(() =>
      resolveReplayParams({
        replayUrl: `https://url-org.sentry.io/replays/${replayDetailsFixture.id}/`,
        organizationSlug: "constrained-org",
      }),
    ).toThrow(
      'Replay URL is outside the active organization constraint. Expected organization "constrained-org" but got "url-org".',
    );
  });

  it("rejects replays outside the active project constraint", async () => {
    mswServer.use(
      http.get(
        "https://us.sentry.io/api/0/projects/sentry-mcp-evals/frontend/",
        () =>
          HttpResponse.json({
            id: "9999999999999999",
            slug: "frontend",
            name: "frontend",
          }),
        { once: true },
      ),
    );

    await expect(
      getReplayDetails.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          replayId: replayDetailsFixture.id,
          regionUrl: "https://us.sentry.io",
        },
        getServerContext({
          constraints: {
            projectSlug: "frontend",
          },
        }),
      ),
    ).rejects.toThrow(
      'Replay is outside the active project constraint. Expected project "frontend".',
    );
  });

  it("uses the constrained regionUrl for replay endpoints", async () => {
    mswServer.use(
      http.get(
        `https://sentry.io/api/0/organizations/sentry-mcp-evals/replays/${replayDetailsFixture.id}/`,
        () => HttpResponse.json({ detail: "wrong host" }, { status: 404 }),
        { once: true },
      ),
      http.get(
        `https://us.sentry.io/api/0/organizations/sentry-mcp-evals/replays/${replayDetailsFixture.id}/`,
        () => HttpResponse.json({ data: replayDetailsFixture }),
        { once: true },
      ),
      http.get(
        `https://us.sentry.io/api/0/projects/sentry-mcp-evals/${replayDetailsFixture.project_id}/replays/${replayDetailsFixture.id}/recording-segments/`,
        () => HttpResponse.json([]),
        { once: true },
      ),
    );

    const result = await getReplayDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        replayId: replayDetailsFixture.id,
      },
      getServerContext({
        constraints: { regionUrl: "https://us.sentry.io" },
      }),
    );

    expect(result).toContain(
      `# Replay ${replayDetailsFixture.id} in **sentry-mcp-evals**`,
    );
  });

  it("resolves the organization region when none is provided", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/",
        () =>
          HttpResponse.json({
            ...organizationFixture,
            links: {
              ...organizationFixture.links,
              regionUrl: "https://us.sentry.io",
            },
          }),
        { once: true },
      ),
      http.get(
        `https://sentry.io/api/0/organizations/sentry-mcp-evals/replays/${replayDetailsFixture.id}/`,
        () => HttpResponse.json({ detail: "wrong host" }, { status: 404 }),
        { once: true },
      ),
      http.get(
        `https://us.sentry.io/api/0/organizations/sentry-mcp-evals/replays/${replayDetailsFixture.id}/`,
        () => HttpResponse.json({ data: replayDetailsFixture }),
        { once: true },
      ),
      http.get(
        `https://us.sentry.io/api/0/projects/sentry-mcp-evals/${replayDetailsFixture.project_id}/replays/${replayDetailsFixture.id}/recording-segments/`,
        () => HttpResponse.json([]),
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
      `# Replay ${replayDetailsFixture.id} in **sentry-mcp-evals**`,
    );
  });

  it("does not repeat explicit payload fields in generic replay events", async () => {
    mswServer.use(
      http.get(
        `https://us.sentry.io/api/0/projects/sentry-mcp-evals/${replayDetailsFixture.project_id}/replays/${replayDetailsFixture.id}/recording-segments/`,
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
        regionUrl: "https://us.sentry.io",
      },
      getServerContext(),
    );

    expect(result).toContain(
      '- T+0s · `console` · message="Payment request failed" · description="POST /api/orders returned 500" · category="network" · type="error" · payload="endpoint=/api/orders, status=500"',
    );
  });

  it("ignores array payloads instead of rendering numeric keys", async () => {
    mswServer.use(
      http.get(
        `https://us.sentry.io/api/0/projects/sentry-mcp-evals/${replayDetailsFixture.project_id}/replays/${replayDetailsFixture.id}/recording-segments/`,
        () =>
          HttpResponse.json([
            [
              {
                type: 5,
                timestamp: 1744027205000,
                data: {
                  tag: "console",
                  payload: ["alpha", "beta"],
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
        regionUrl: "https://us.sentry.io",
      },
      getServerContext(),
    );

    expect(result).not.toContain("- T+0s · `console`");
    expect(result).not.toContain('payload="0=');
  });

  describe("tool definition", () => {
    it("requires the replay read scopes used by the backend endpoints", () => {
      expect(getReplayDetails.requiredScopes).toEqual([
        "org:read",
        "project:read",
        "event:read",
      ]);
    });

    it("accepts regionUrl so constrained sessions can inject it", () => {
      expect(Object.keys(getReplayDetails.inputSchema)).toEqual([
        "replayUrl",
        "organizationSlug",
        "replayId",
        "regionUrl",
      ]);
    });
  });
});
