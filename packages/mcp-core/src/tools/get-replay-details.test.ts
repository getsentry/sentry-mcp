import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import getReplayDetails from "./get-replay-details.js";
import { getServerContext } from "../test-setup.js";

const replayDetailsFixture = {
  id: "7e07485f-12f9-416b-8b14-26260799b51f",
  project_id: "4509062593708032",
  started_at: "2025-04-07T12:00:00.000Z",
  finished_at: "2025-04-07T12:05:00.000Z",
  duration: 300,
  is_archived: false,
  environment: "production",
  platform: "javascript",
  count_errors: 1,
  count_warnings: 2,
  count_infos: 3,
  count_dead_clicks: 1,
  count_rage_clicks: 0,
  count_segments: 2,
  count_urls: 2,
  urls: ["/login", "/checkout"],
  trace_ids: ["a4d1aae7216b47ff8117cf4e09ce9d0a"],
  error_ids: ["err-1"],
  browser: { name: "Chrome", version: "123.0" },
  os: { name: "macOS", version: "14.4" },
  device: { family: "Mac", model: "MacBook Pro", name: "MacBook Pro" },
  sdk: { name: "@sentry/browser", version: "8.0.0" },
  user: {
    display_name: "Taylor Example",
    email: "taylor@example.com",
    id: "user-1",
  },
};

const replaySegmentsFixture = [
  [
    {
      type: 4,
      timestamp: 1744027200000,
      data: { href: "https://example.com/login", width: 1440, height: 900 },
    },
    {
      type: 5,
      timestamp: 1744027210,
      data: {
        tag: "performanceSpan",
        payload: {
          op: "navigation.navigate",
          description: "https://example.com/checkout",
          data: { duration: 710 },
        },
      },
    },
  ],
  [
    {
      type: 5,
      timestamp: 1744027220,
      data: {
        tag: "ui.click",
        payload: {
          message: "Clicked submit order",
        },
      },
    },
  ],
];

function mockReplayApis({
  replay = replayDetailsFixture,
  segments = replaySegmentsFixture,
}: {
  replay?: Record<string, unknown>;
  segments?: unknown[][];
} = {}) {
  mswServer.use(
    http.get(
      `https://sentry.io/api/0/organizations/test-org/replays/${replay.id}/`,
      () => HttpResponse.json({ data: replay }),
      { once: true },
    ),
    http.get(
      `https://sentry.io/api/0/projects/test-org/${replay.project_id}/replays/${replay.id}/recording-segments/`,
      () => HttpResponse.json(segments),
      { once: true },
    ),
  );
}

describe("get_replay_details", () => {
  it("loads replay details from replayUrl", async () => {
    mockReplayApis();

    const result = await getReplayDetails.handler(
      {
        replayUrl: `https://test-org.sentry.io/replays/${replayDetailsFixture.id}/`,
      },
      getServerContext(),
    );

    expect(result).toContain(
      `# Replay ${replayDetailsFixture.id} in **test-org**`,
    );
    expect(result).toContain("**User**: Taylor Example");
    expect(result).toContain("view loaded https://example.com/login");
    expect(result).toContain("Clicked submit order");
  });

  it("loads replay details from organizationSlug and replayId", async () => {
    mockReplayApis();

    const result = await getReplayDetails.handler(
      {
        organizationSlug: "test-org",
        replayId: replayDetailsFixture.id,
      },
      getServerContext(),
    );

    expect(result).toContain("**Project ID**: 4509062593708032");
    expect(result).toContain("**Trace IDs**: a4d1aae7216b47ff8117cf4e09ce9d0a");
  });

  it("skips segment-derived timeline for archived replays", async () => {
    const archivedReplay = {
      ...replayDetailsFixture,
      is_archived: true,
    };
    mswServer.use(
      http.get(
        `https://sentry.io/api/0/organizations/test-org/replays/${archivedReplay.id}/`,
        () => HttpResponse.json({ data: archivedReplay }),
        { once: true },
      ),
    );

    const result = await getReplayDetails.handler(
      {
        organizationSlug: "test-org",
        replayId: archivedReplay.id,
      },
      getServerContext(),
    );

    expect(result).toContain("Replay recording data is archived");
    expect(result).not.toContain("view loaded https://example.com/login");
  });

  it("degrades gracefully when segment fetch fails", async () => {
    mswServer.use(
      http.get(
        `https://sentry.io/api/0/organizations/test-org/replays/${replayDetailsFixture.id}/`,
        () => HttpResponse.json({ data: replayDetailsFixture }),
        { once: true },
      ),
      http.get(
        `https://sentry.io/api/0/projects/test-org/${replayDetailsFixture.project_id}/replays/${replayDetailsFixture.id}/recording-segments/`,
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
        organizationSlug: "test-org",
        replayId: replayDetailsFixture.id,
      },
      getServerContext(),
    );

    expect(result).toContain(
      "Replay details loaded, but the deeper recording data could not be fetched",
    );
    expect(result).toContain("Replay recording segment not found.");
  });

  it("throws for invalid direct input", async () => {
    await expect(
      getReplayDetails.handler({}, getServerContext()),
    ).rejects.toThrow(
      "Provide either `replayUrl` or both `organizationSlug` and `replayId`.",
    );
  });
});
