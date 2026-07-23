import { mswServer, replayDetailsFixture } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { getServerContext } from "../../test-setup.js";
import inspectReplayTimeline from "./inspect-replay-timeline.js";

const replayUrl = `https://sentry-mcp-evals.sentry.io/explore/replays/${replayDetailsFixture.id}/`;

describe("inspect_replay_timeline", () => {
  it("returns a timestamped replay activity timeline", async () => {
    const result = await inspectReplayTimeline.handler(
      { replayUrl },
      getServerContext(),
    );

    expect(result).toMatchInlineSnapshot(`
      "# Replay Timeline 7e07485f-12f9-416b-8b14-26260799b51f in **sentry-mcp-evals**

      - **Replay URL**: https://sentry-mcp-evals.sentry.io/explore/replays/7e07485f-12f9-416b-8b14-26260799b51f/
      - **Started**: 2025-04-07T12:00:00.000Z

      ## Timeline

      - T+0s · **navigation** · \`Page view\` · url=\"https://example.com/login\"
      - T+10s · **navigation** · \`navigation.navigate\` · message=\"https://example.com/checkout\" · duration_ms=710
      - T+20s · **click** · \`ui.click\` · message=\"Clicked submit order\"

      ## Response Notes

      - Use \`get_replay_details\` with this replay URL to inspect related issues and traces."
    `);
  });

  it("filters by event type and absolute time window", async () => {
    const result = await inspectReplayTimeline.handler(
      {
        replayUrl,
        aroundTimestamp: "2025-04-07T12:00:20.000Z",
        windowSeconds: 2,
        eventTypes: ["click"],
      },
      getServerContext(),
    );

    expect(result).toContain(
      "- **Time Window**: 2s before and after 2025-04-07T12:00:20.000Z",
    );
    expect(result).toContain("- **Event Types**: click");
    expect(result).toContain("**click**");
    expect(result).not.toContain("**navigation**");
  });

  it("reports archived recordings without fetching segments", async () => {
    mswServer.use(
      http.get(
        `https://us.sentry.io/api/0/organizations/sentry-mcp-evals/replays/${replayDetailsFixture.id}/`,
        () =>
          HttpResponse.json({
            data: { ...replayDetailsFixture, is_archived: true },
          }),
        { once: true },
      ),
    );

    const result = await inspectReplayTimeline.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        replayId: replayDetailsFixture.id,
        regionUrl: "https://us.sentry.io",
      },
      getServerContext(),
    );

    expect(result).toContain(
      "The recording is archived, so its activity timeline is no longer available.",
    );
  });

  it("surfaces recording fetch failures instead of returning an empty timeline", async () => {
    mswServer.use(
      http.get(
        `https://us.sentry.io/api/0/projects/sentry-mcp-evals/${replayDetailsFixture.project_id}/replays/${replayDetailsFixture.id}/recording-segments/`,
        () => HttpResponse.json({ detail: "not found" }, { status: 404 }),
        { once: true },
      ),
    );

    await expect(
      inspectReplayTimeline.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          replayId: replayDetailsFixture.id,
          regionUrl: "https://us.sentry.io",
        },
        getServerContext(),
      ),
    ).rejects.toThrow();
  });

  it("rejects missing replay identity", async () => {
    await expect(
      inspectReplayTimeline.handler({}, getServerContext()),
    ).rejects.toThrow(
      "Provide either `replayUrl` or both `organizationSlug` and `replayId`.",
    );
  });
});
