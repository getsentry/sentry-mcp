import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer, replayDetailsFixture } from "@sentry/mcp-server-mocks";
import getReplayDetails from "./get-replay-details.js";
import { getServerContext } from "../test-setup.js";

describe("get_replay_details", () => {
  it("loads replay details from replayUrl", async () => {
    const result = await getReplayDetails.handler(
      {
        replayUrl: `https://sentry-mcp-evals.sentry.io/replays/${replayDetailsFixture.id}/`,
      },
      getServerContext(),
    );

    expect(result).toContain(
      `# Replay ${replayDetailsFixture.id} in **sentry-mcp-evals**`,
    );
    expect(result).toContain("**User**: Taylor Example");
    expect(result).toContain("view loaded https://example.com/login");
    expect(result).toContain("Clicked submit order");
  });

  it("loads replay details from organizationSlug and replayId", async () => {
    const result = await getReplayDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        replayId: replayDetailsFixture.id,
      },
      getServerContext(),
    );

    expect(result).toContain(
      `**Project ID**: ${replayDetailsFixture.project_id}`,
    );
    expect(result).toContain("**Trace IDs**: a4d1aae7216b47ff8117cf4e09ce9d0a");
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

    expect(result).toContain("Replay recording data is archived");
    expect(result).not.toContain("view loaded https://example.com/login");
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
