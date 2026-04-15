import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import {
  mswServer,
  organizationFixture,
  replayDetailsFixture,
} from "@sentry/mcp-server-mocks";
import getReplayDetails, { resolveReplayParams } from "./get-replay-details.js";
import { getServerContext } from "../test-setup.js";

describe("get_replay_details", () => {
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

      ## Activity

      - T+0s · \`page.view\` · href=https://example.com/login
      - T+10s · \`navigation.navigate\` · description=https://example.com/checkout · duration_ms=710
      - T+20s · \`ui.click\` · message="Clicked submit order"

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

  it("prefers explicit organizationSlug over replayUrl org when both are provided", () => {
    expect(
      resolveReplayParams({
        replayUrl: `https://url-org.sentry.io/replays/${replayDetailsFixture.id}/`,
        organizationSlug: "constrained-org",
      }),
    ).toEqual({
      organizationSlug: "constrained-org",
      replayId: replayDetailsFixture.id,
    });
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
