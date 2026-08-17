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

      ## Map

      - **Signals**: 8 signals across T+0.5s–T+3m 41.7s
      - **Flow**: /login ▸ /checkout
      - **Kinds**: navigation 3 · click 4 (1 rage, 1 dead) · network 2 (1 failed) · console 1 (1 error)
      - **Truncated**: no

      ## Chapters

      - T+0.5s–T+14.2s  Signed in and navigated to checkout
      - T+3m 0.6s–T+3m 8.4s  Complete order failed with a server error
      - T+3m 41.7s–T+3m 48.7s  Download receipt link did not respond

      ## Related

      - **CLOUDFLARE-MCP-41**: Error: Tool list_organizations is already registered
      - Trace \`a4d1aae7216b47ff8117cf4e09ce9d0a\` (112 spans)

      Use \`get_sentry_resource\` to inspect any issue or trace listed above.

      ## Next

      Error CLOUDFLARE-MCP-41 occurred at T+3m 1.3s. Use the Sentry tool \`get_replay_activity\` to read the signals in a time window:
      get_replay_activity(organizationSlug='sentry-mcp-evals', replayId='7e07485f-12f9-416b-8b14-26260799b51f', startMs=176300, endMs=186300, grain='detail')"
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

      ## Map

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

      ## Map

      Recording is unavailable.

      ## Chapters

      - T+0.5s–T+14.2s  Signed in and navigated to checkout
      - T+3m 0.6s–T+3m 8.4s  Complete order failed with a server error
      - T+3m 41.7s–T+3m 48.7s  Download receipt link did not respond

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

  it("ignores events whose tag is not one the SDK emits", async () => {
    // `tag: "console"` is not a shape the SDK produces — meaning lives in
    // `payload.category` under `tag: "breadcrumb"`. Such an event is
    // unclassifiable, and inventing a rendering for it is what produced the
    // old `breadcrumb`-labeled output.
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
                    category: "network",
                    type: "error",
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

    expect(result).toContain("No activity recorded.");
    expect(result).not.toContain("Payment request failed");
  });

  it("classifies a real SDK-shaped console error", async () => {
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
                  tag: "breadcrumb",
                  payload: {
                    type: "default",
                    category: "console",
                    level: "error",
                    message: "Payment request failed",
                    data: { logger: "console" },
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

    expect(result).toContain("**Kinds**: console 1 (1 error)");
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

  describe("summary chapters", () => {
    const SUMMARIZE_URL = `https://us.sentry.io/api/0/projects/sentry-mcp-evals/${replayDetailsFixture.project_id}/replays/${replayDetailsFixture.id}/summarize/`;

    async function loadReplay() {
      return getReplayDetails.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          replayId: replayDetailsFixture.id,
          regionUrl: "https://us.sentry.io",
        },
        getServerContext(),
      );
    }

    it("issues exactly one read and never starts a summary task", async () => {
      // Starting would spend a Seer LLM run per call for a section that would
      // not be ready anyway; polling would put unbounded latency on the map.
      const calls: string[] = [];
      mswServer.use(
        http.all(SUMMARIZE_URL, ({ request }) => {
          calls.push(request.method);
          return HttpResponse.json({ data: null, status: "processing" });
        }),
      );

      await loadReplay();

      expect(calls).toEqual(["GET"]);
    });

    // A stale summary can carry chapter data alongside a non-completed
    // status. Rendering it would present partial or superseded analysis as
    // current, so the status — not the presence of data — decides.
    const staleChapters = {
      time_ranges: [
        {
          period_start: 1744027200500,
          period_end: 1744027214200,
          period_title: "Stale chapter from a superseded run",
        },
      ],
      summary: "Superseded.",
    };

    for (const [label, respond] of [
      [
        "a permission error",
        () => HttpResponse.json({ detail: "no" }, { status: 403 }),
      ],
      [
        "a still-running task",
        () => HttpResponse.json({ data: null, status: "processing" }),
      ],
      [
        "a not-started task",
        () => HttpResponse.json({ data: null, status: "not_started" }),
      ],
      [
        "an error status",
        () => HttpResponse.json({ data: null, status: "error" }),
      ],
      [
        "a still-running task that carries stale chapter data",
        () => HttpResponse.json({ data: staleChapters, status: "processing" }),
      ],
      [
        "an errored task that carries stale chapter data",
        () => HttpResponse.json({ data: staleChapters, status: "error" }),
      ],
      ["an unparseable body", () => HttpResponse.json({ nonsense: true })],
      [
        "a server failure",
        () => HttpResponse.json({ detail: "boom" }, { status: 500 }),
      ],
    ] as const) {
      it(`omits chapters on ${label} without degrading the map`, async () => {
        mswServer.use(http.get(SUMMARIZE_URL, respond));

        const result = await loadReplay();

        expect(result).not.toContain("## Chapters");
        // The map is the primary content; chapters are additive by
        // construction and must never take it down with them.
        expect(result).toContain("## Map");
        expect(result).toContain(
          "**Kinds**: navigation 3 · click 4 (1 rage, 1 dead) · network 2 (1 failed) · console 1 (1 error)",
        );
      });
    }
  });

  describe("suggested next call", () => {
    const EVENTS_META_URL =
      "https://us.sentry.io/api/0/organizations/sentry-mcp-evals/replays-events-meta/";

    async function loadReplay() {
      return getReplayDetails.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          replayId: replayDetailsFixture.id,
          regionUrl: "https://us.sentry.io",
        },
        getServerContext(),
      );
    }

    it("brackets a resolved error timestamp", async () => {
      const result = await loadReplay();

      // The fixture error lands at T+3m 1.3s (181,300ms), so the window is
      // that offset padded either side.
      expect(result).toContain("Error CLOUDFLARE-MCP-41 occurred at T+3m 1.3s");
      expect(result).toContain("startMs=176300, endMs=186300, grain='detail'");
    });

    for (const [label, respond] of [
      [
        "the private endpoint is unauthorized",
        () => HttpResponse.json({ detail: "no" }, { status: 403 }),
      ],
      [
        "the lookup fails",
        () => HttpResponse.json({ detail: "boom" }, { status: 500 }),
      ],
      ["no events resolve", () => HttpResponse.json({ data: [] })],
      [
        "the timestamp is unusable",
        () =>
          HttpResponse.json({
            data: [{ id: "7ca573c0f4814912aaa9bdc77d1a7d51", timestamp: "?" }],
          }),
      ],
    ] as const) {
      it(`falls back to a whole-session digest when ${label}`, async () => {
        mswServer.use(http.get(EVENTS_META_URL, respond));

        const result = await loadReplay();

        expect(result).toContain("grain='digest'");
        expect(result).not.toContain("startMs=");
        // Degrading the suggestion must not degrade the map.
        expect(result).toContain("**Signals**: 8 signals");
      });
    }

    it("still lists an error id the lookup could not resolve", async () => {
      // `error_ids` is the replay's own record that an error occurred, so
      // dropping it would understate the session.
      mswServer.use(
        http.get(EVENTS_META_URL, () => HttpResponse.json({ data: [] })),
      );

      const result = await loadReplay();

      expect(result).toContain("- Event `7ca573c0f4814912aaa9bdc77d1a7d51`");
    });
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
