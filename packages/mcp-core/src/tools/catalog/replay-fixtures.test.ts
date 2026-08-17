/**
 * Contract tests for the replay mock fixtures.
 *
 * The replay work depends on fixtures that reflect what Sentry and the browser
 * SDK actually emit — the previous fixtures used an event shape the SDK never
 * produces, so tests passed while real output degraded. These tests pin the
 * fixture shapes and the mock endpoints that consume them, including the ones
 * no tool reads yet (segment paging, `replays-events-meta`, and the summarize
 * endpoint), so they cannot silently drift before the tools arrive.
 */
import { describe, expect, it } from "vitest";
import {
  PAGED_REPLAY_ID,
  replayDetailsFixture,
  replayRecordingSegmentsFixture,
  replayRecordingSegmentsPagedFixture,
} from "@sentry/mcp-server-mocks";

const SEGMENTS_PATH = (replayId: string) =>
  `https://us.sentry.io/api/0/projects/sentry-mcp-evals/${replayDetailsFixture.project_id}/replays/${replayId}/recording-segments/`;

type ReplayEvent = {
  type: number;
  timestamp: number;
  data?: { tag?: string; payload?: Record<string, any> };
};

function eventsOf(segments: unknown): ReplayEvent[] {
  return (segments as ReplayEvent[][]).flat();
}

function categoriesOf(segments: unknown): string[] {
  return eventsOf(segments)
    .filter((event) => event.data?.tag === "breadcrumb")
    .map((event) => event.data?.payload?.category as string);
}

function opsOf(segments: unknown): string[] {
  return eventsOf(segments)
    .filter((event) => event.data?.tag === "performanceSpan")
    .map((event) => event.data?.payload?.op as string);
}

describe("replay recording segment fixtures", () => {
  it("carries user actions as breadcrumb events, not as bare tags", () => {
    // The SDK emits every user action as a custom event tagged `breadcrumb`,
    // with the meaning in `payload.category`. A `tag` of `ui.click` is a shape
    // the SDK never produces.
    const tags = new Set(
      eventsOf(replayRecordingSegmentsFixture)
        .map((event) => event.data?.tag)
        .filter(Boolean),
    );

    expect(tags).toEqual(new Set(["breadcrumb", "performanceSpan", "options"]));
    expect(categoriesOf(replayRecordingSegmentsFixture)).toContain("ui.click");
  });

  it("covers each event type the classifier must distinguish", () => {
    const categories = categoriesOf(replayRecordingSegmentsFixture);
    const ops = opsOf(replayRecordingSegmentsFixture);

    expect(categories).toEqual(
      expect.arrayContaining([
        "ui.click",
        "console",
        "navigation",
        "ui.slowClickDetected",
      ]),
    );
    expect(ops).toEqual(
      expect.arrayContaining([
        "navigation.navigate",
        "resource.fetch",
        "resource.script",
      ]),
    );
    expect(
      eventsOf(replayRecordingSegmentsFixture).some(
        (event) => event.data?.tag === "options",
      ),
    ).toBe(true);
  });

  it("includes both a failed and a successful network request", () => {
    // Upstream renders only failures but counts every request, so the fixture
    // must contain both to tell those behaviours apart.
    const statuses = eventsOf(replayRecordingSegmentsFixture)
      .filter((event) => event.data?.payload?.op === "resource.fetch")
      .map((event) => event.data?.payload?.data?.statusCode);

    expect(statuses).toEqual(expect.arrayContaining([200, 500]));
  });

  it("distinguishes a rage click from a plain dead click behaviorally", () => {
    // Both are `ui.slowClickDetected`; only `clickCount` separates them.
    const slowClicks = eventsOf(replayRecordingSegmentsFixture)
      .filter(
        (event) => event.data?.payload?.category === "ui.slowClickDetected",
      )
      .map((event) => event.data?.payload?.data);

    expect(slowClicks).toHaveLength(2);
    for (const click of slowClicks) {
      // Dead-click conditions: timeout, interactive target, >= 7000ms.
      expect(click.endReason).toBe("timeout");
      expect(["a", "button", "input"]).toContain(click.node.tagName);
      expect(click.timeAfterClickMs).toBeGreaterThanOrEqual(7000);
    }

    const clickCounts = slowClicks.map((click) => click.clickCount).sort();
    expect(clickCounts).toEqual([1, 5]);
  });

  it("uses second timestamps for spans and millisecond timestamps for breadcrumbs", () => {
    // Timestamp unit is a function of event type, not magnitude — the fixture
    // has to exercise both or the per-type unit fix is untestable.
    for (const event of eventsOf(replayRecordingSegmentsFixture)) {
      if (event.data?.tag === "performanceSpan") {
        expect(event.timestamp).toBeLessThan(1e12);
      }
      if (event.data?.tag === "breadcrumb") {
        expect(event.timestamp).toBeGreaterThan(1e12);
      }
    }
  });

  it("reports rage and dead click counts consistent with the recording", () => {
    // Upstream counts a rage click as dead too (`count_dead_clicks` sums
    // `click_is_dead`, which is set for DEAD_CLICK and RAGE_CLICK alike).
    expect(replayDetailsFixture.count_rage_clicks).toBe(1);
    expect(replayDetailsFixture.count_dead_clicks).toBe(2);
  });
});

describe("replay mock endpoints", () => {
  it("serves the whole recording in one page when it fits", async () => {
    const response = await fetch(SEGMENTS_PATH(replayDetailsFixture.id));

    expect(await response.json()).toEqual(replayRecordingSegmentsFixture);
    // Sentry always sends a Link header; `results="false"` — not an absent
    // header — is how the last page is signalled.
    expect(response.headers.get("Link")).toContain(
      'rel="next"; results="false"',
    );
  });

  it("pages a long recording through the Link header cursor", async () => {
    const pages: unknown[][] = [];
    let cursor: string | null = "";

    while (cursor !== null) {
      const url = new URL(SEGMENTS_PATH(PAGED_REPLAY_ID));
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }

      const response: Response = await fetch(url);
      pages.push((await response.json()) as unknown[]);

      const nextLink = (response.headers.get("Link") ?? "")
        .split(",")
        .find(
          (link) =>
            link.includes('rel="next"') && link.includes('results="true"'),
        );
      cursor = nextLink?.match(/cursor="([^"]+)"/)?.[1] ?? null;
    }

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flat()).toEqual(replayRecordingSegmentsPagedFixture);
  });

  it("truncates to the first page when the cursor is ignored", async () => {
    // This is the bug the paging fix has to close: without following the
    // header, later segments are silently missing.
    const response = await fetch(SEGMENTS_PATH(PAGED_REPLAY_ID));
    const firstPage = (await response.json()) as unknown[];

    expect(firstPage.length).toBeLessThan(
      replayRecordingSegmentsPagedFixture.length,
    );
  });

  it("resolves replay error ids to issue identity and a ms-precision timestamp", async () => {
    const url = new URL(
      "https://us.sentry.io/api/0/organizations/sentry-mcp-evals/replays-events-meta/",
    );
    url.searchParams.set(
      "query",
      `id:[${replayDetailsFixture.error_ids.join(",")}]`,
    );

    const body = (await (await fetch(url)).json()) as {
      data: Record<string, unknown>[];
    };

    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: replayDetailsFixture.error_ids[0],
      issue: "CLOUDFLARE-MCP-41",
      title: "Error: Tool list_organizations is already registered",
    });
    // The endpoint folds millisecond precision into `timestamp` and deletes
    // `timestamp_ms`, so the suggested window has to parse it from here.
    expect(body.data[0]).not.toHaveProperty("timestamp_ms");
    expect(Date.parse(body.data[0].timestamp as string)).not.toBeNaN();
  });

  it("returns a completed Seer summary with millisecond chapter windows", async () => {
    const body = (await (
      await fetch(
        `https://us.sentry.io/api/0/projects/sentry-mcp-evals/${replayDetailsFixture.project_id}/replays/${replayDetailsFixture.id}/summarize/`,
      )
    ).json()) as {
      status: string;
      data: { time_ranges: { period_start: number; period_end: number }[] };
    };

    expect(body.status).toBe("completed");
    for (const chapter of body.data.time_ranges) {
      expect(chapter.period_start).toBeGreaterThan(1e12);
      expect(chapter.period_end).toBeGreaterThan(chapter.period_start);
    }
  });
});
