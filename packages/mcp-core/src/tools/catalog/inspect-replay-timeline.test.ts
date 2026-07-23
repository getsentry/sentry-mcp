import { mswServer, replayDetailsFixture } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { getServerContext } from "../../test-setup.js";
import {
  assertStructuredOnlyResult,
  getStructuredContent,
} from "../../test-utils/structured-content.js";
import inspectReplayTimeline from "./inspect-replay-timeline.js";

const replayUrl = `https://sentry-mcp-evals.sentry.io/explore/replays/${replayDetailsFixture.id}/`;

describe("inspect_replay_timeline", () => {
  it("returns a timestamped replay activity timeline", async () => {
    const result = await inspectReplayTimeline.handler(
      { replayUrl },
      getServerContext(),
    );

    assertStructuredOnlyResult(result);
    expect(getStructuredContent(result)).toMatchInlineSnapshot(`
      {
        "events": [
          {
            "details": [
              {
                "key": "url",
                "value": "https://example.com/login",
              },
            ],
            "label": "Page view",
            "offsetMs": 0,
            "timestampMs": 1744027200000,
            "type": "navigation",
          },
          {
            "details": [
              {
                "key": "message",
                "value": "https://example.com/checkout",
              },
              {
                "key": "durationMs",
                "value": 710,
              },
            ],
            "label": "navigation.navigate",
            "offsetMs": 10000,
            "timestampMs": 1744027210000,
            "type": "navigation",
          },
          {
            "details": [
              {
                "key": "message",
                "value": "Clicked submit order",
              },
            ],
            "label": "ui.click",
            "offsetMs": 20000,
            "timestampMs": 1744027220000,
            "type": "click",
          },
        ],
        "filters": {
          "aroundTimestamp": null,
          "eventTypes": [],
          "limit": 50,
          "windowSeconds": 30,
        },
        "omittedCount": 0,
        "organizationSlug": "sentry-mcp-evals",
        "replayId": "7e07485f-12f9-416b-8b14-26260799b51f",
        "replayUrl": "https://sentry-mcp-evals.sentry.io/explore/replays/7e07485f-12f9-416b-8b14-26260799b51f/",
        "startedAt": "2025-04-07T12:00:00.000Z",
        "status": "available",
        "totalMatchingEvents": 3,
        "unavailableReason": null,
      }
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

    const structuredContent = getStructuredContent<{
      filters: {
        aroundTimestamp: string;
        windowSeconds: number;
        eventTypes: string[];
      };
      events: Array<{ type: string }>;
    }>(result);
    expect(structuredContent.filters).toMatchObject({
      aroundTimestamp: "2025-04-07T12:00:20.000Z",
      windowSeconds: 2,
      eventTypes: ["click"],
    });
    expect(structuredContent.events).toEqual([
      expect.objectContaining({ type: "click" }),
    ]);
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

    assertStructuredOnlyResult(result);
    expect(getStructuredContent(result)).toMatchObject({
      status: "archived",
      unavailableReason:
        "The recording is archived, so its activity timeline is no longer available.",
      totalMatchingEvents: 0,
      omittedCount: 0,
      events: [],
    });
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
