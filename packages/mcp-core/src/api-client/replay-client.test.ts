/**
 * Tests for the replay-specific API client methods.
 *
 * These cover the contracts that are easy to get wrong and expensive to get
 * wrong silently: segment pagination (whose absence truncated long recordings
 * without saying so), the read budgets, and the two endpoints whose responses
 * are experimental or private.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import {
  PAGED_REPLAY_ID,
  mswServer,
  replayDetailsFixture,
  replayRecordingSegmentsFixture,
  replayRecordingSegmentsPagedFixture,
  replaySummaryProcessingFixture,
} from "@sentry/mcp-server-mocks";
import { SentryApiService } from "./client.js";

const apiService = new SentryApiService({
  host: "sentry.io",
  accessToken: "test-token",
});

const SEGMENTS_URL = (replayId: string) =>
  `https://sentry.io/api/0/projects/sentry-mcp-evals/${replayDetailsFixture.project_id}/replays/${replayId}/recording-segments/`;

const SUMMARIZE_URL = `https://sentry.io/api/0/projects/sentry-mcp-evals/${replayDetailsFixture.project_id}/replays/${replayDetailsFixture.id}/summarize/`;

function readSegments(replayId: string, overrides = {}) {
  return apiService.getReplayRecordingSegments({
    organizationSlug: "sentry-mcp-evals",
    projectSlugOrId: String(replayDetailsFixture.project_id),
    replayId,
    ...overrides,
  });
}

afterEach(() => {
  // Per-test handler overrides are not reset automatically, and a leaked stub
  // silently changes what a later test is measuring.
  mswServer.resetHandlers();
  vi.restoreAllMocks();
});

describe("getReplayRecordingSegments", () => {
  it("returns a single-page recording whole", async () => {
    const result = await readSegments(replayDetailsFixture.id);

    expect(result.segments).toEqual(replayRecordingSegmentsFixture);
    expect(result.truncatedBy).toBeNull();
    expect(result.segmentsRead).toBe(replayRecordingSegmentsFixture.length);
  });

  it("follows the Link header cursor across pages", async () => {
    // The bug this closes: without following the header, a recording longer
    // than one page is silently cut off at the first page.
    const result = await readSegments(PAGED_REPLAY_ID);

    expect(result.segments).toEqual(replayRecordingSegmentsPagedFixture);
    expect(result.segmentsRead).toBe(
      replayRecordingSegmentsPagedFixture.length,
    );
    expect(result.truncatedBy).toBeNull();
  });

  it("does not send the download parameter, which this endpoint has no concept of", async () => {
    const requested: string[] = [];
    mswServer.use(
      http.get(SEGMENTS_URL(PAGED_REPLAY_ID), ({ request }) => {
        requested.push(request.url);
        return HttpResponse.json([]);
      }),
    );

    await readSegments(PAGED_REPLAY_ID);

    expect(requested).toHaveLength(1);
    expect(requested[0]).not.toContain("download");
  });

  it("stops at the segment budget and says so", async () => {
    const result = await readSegments(PAGED_REPLAY_ID, { maxSegments: 3 });

    expect(result.segmentsRead).toBe(3);
    expect(result.truncatedBy).toBe("segments");
    // The caller must be able to distinguish this from a short recording.
    expect(result.segments).toHaveLength(3);
  });

  it("stops at the byte budget and says so", async () => {
    const result = await readSegments(PAGED_REPLAY_ID, { maxBytes: 1 });

    expect(result.truncatedBy).toBe("bytes");
    expect(result.bytesRead).toBeGreaterThan(0);
    // The page that tripped the budget is already parsed, so it is kept
    // rather than thrown away.
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.segments.length).toBeLessThan(
      replayRecordingSegmentsPagedFixture.length,
    );
  });

  it("reports how many bytes were read", async () => {
    const result = await readSegments(replayDetailsFixture.id);
    expect(result.bytesRead).toBe(
      JSON.stringify(replayRecordingSegmentsFixture).length,
    );
  });

  it("surfaces a malformed body as an error rather than an empty recording", async () => {
    mswServer.use(
      http.get(SEGMENTS_URL(replayDetailsFixture.id), () =>
        HttpResponse.text("not json", {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(readSegments(replayDetailsFixture.id)).rejects.toThrow(
      /Failed to parse replay recording segments/,
    );
  });
});

describe("streamReplayRecordingSegments", () => {
  function streamSegments(
    replayId: string,
    onSegment: (segment: unknown, index: number) => "stop" | void,
    overrides = {},
  ) {
    return apiService.streamReplayRecordingSegments(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlugOrId: String(replayDetailsFixture.project_id),
        replayId,
        ...overrides,
      },
      onSegment,
    );
  }

  it("delivers every segment in wire order without retaining them", async () => {
    const seen: number[] = [];
    const stats = await streamSegments(PAGED_REPLAY_ID, (_segment, index) => {
      seen.push(index);
    });

    expect(seen).toEqual([0, 1, 2, 3, 4]);
    expect(stats.segmentsRead).toBe(replayRecordingSegmentsPagedFixture.length);
    expect(stats.truncatedBy).toBeNull();
    // The stats shape is the buffering read's minus the payload, so callers
    // can report the same bounds without holding the recording.
    expect(stats).not.toHaveProperty("segments");
  });

  it("stops paging when the callback says stop", async () => {
    // The point of the early exit: a read that has passed the moment it cares
    // about should not fetch the rest of the session.
    const requested: string[] = [];
    mswServer.use(
      http.get(SEGMENTS_URL(PAGED_REPLAY_ID), ({ request }) => {
        requested.push(request.url);
        return HttpResponse.json([replayRecordingSegmentsPagedFixture[0]], {
          headers: {
            Link: `<${SEGMENTS_URL(PAGED_REPLAY_ID)}?cursor=0:1:0>; rel="next"; results="true"; cursor="0:1:0"`,
          },
        });
      }),
    );

    const stats = await streamSegments(PAGED_REPLAY_ID, () => "stop");

    expect(requested).toHaveLength(1);
    expect(stats.segmentsRead).toBe(1);
    // Stopping by choice is not truncation; conflating them would make a
    // deliberate early exit look like a lost tail.
    expect(stats.truncatedBy).toBeNull();
  });

  it("reports the segment budget the same way the buffering read does", async () => {
    const stats = await streamSegments(PAGED_REPLAY_ID, () => {}, {
      maxSegments: 3,
    });

    expect(stats.segmentsRead).toBe(3);
    expect(stats.truncatedBy).toBe("segments");
  });

  it("reports the byte budget the same way the buffering read does", async () => {
    const stats = await streamSegments(PAGED_REPLAY_ID, () => {}, {
      maxBytes: 1,
    });

    expect(stats.truncatedBy).toBe("bytes");
    expect(stats.bytesRead).toBeGreaterThan(0);
  });

  it("agrees with the buffering read on what it saw", async () => {
    // The buffering read is now a thin wrapper over this one, so any drift
    // between them is a bug in the wrapper.
    const streamed: unknown[] = [];
    const stats = await streamSegments(PAGED_REPLAY_ID, (segment) => {
      streamed.push(segment);
    });
    const buffered = await readSegments(PAGED_REPLAY_ID);

    expect(streamed).toEqual(buffered.segments);
    expect(stats.segmentsRead).toBe(buffered.segmentsRead);
    expect(stats.bytesRead).toBe(buffered.bytesRead);
  });
});

describe("getReplayErrorEvents", () => {
  it("resolves a batch of error ids in one request", async () => {
    const requested: string[] = [];
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/replays-events-meta/",
        ({ request }) => {
          requested.push(request.url);
          return HttpResponse.json({
            data: [
              {
                id: "aaa",
                issue: "CLOUDFLARE-MCP-41",
                "issue.id": 6507376925,
                title: "Error: boom",
                timestamp: "2025-04-07T12:03:01.300000+00:00",
              },
            ],
          });
        },
      ),
    );

    const events = await apiService.getReplayErrorEvents({
      organizationSlug: "sentry-mcp-evals",
      errorIds: ["aaa", "bbb"],
    });

    expect(requested).toHaveLength(1);
    expect(decodeURIComponent(requested[0])).toContain("query=id:[aaa,bbb]");
    // issue.id arrives as a number from Snuba; every other issue identifier in
    // this client is a string.
    expect(events[0]["issue.id"]).toBe("6507376925");
    expect(Date.parse(events[0].timestamp as string)).not.toBeNaN();
  });

  it("skips the request entirely when there are no error ids", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      apiService.getReplayErrorEvents({
        organizationSlug: "sentry-mcp-evals",
        errorIds: [],
      }),
    ).resolves.toEqual([]);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tolerates the private endpoint omitting optional fields", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/replays-events-meta/",
        () => HttpResponse.json({ data: [{ id: "aaa" }] }),
      ),
    );

    const events = await apiService.getReplayErrorEvents({
      organizationSlug: "sentry-mcp-evals",
      errorIds: ["aaa"],
    });

    // A missing issue.id normalizes to null rather than being absent, so
    // callers have one shape to handle instead of two.
    expect(events).toEqual([{ id: "aaa", "issue.id": null }]);
  });
});

describe("getReplaySummary", () => {
  it("reads a completed summary with millisecond chapter windows", async () => {
    const summary = await apiService.getReplaySummary({
      organizationSlug: "sentry-mcp-evals",
      projectSlugOrId: String(replayDetailsFixture.project_id),
      replayId: replayDetailsFixture.id,
    });

    expect(summary.status).toBe("completed");
    expect(summary.data?.time_ranges?.[0].period_start).toBeGreaterThan(1e12);
  });

  it("issues exactly one GET and never starts a task", async () => {
    // Starting would spend a Seer LLM run per call and still report
    // `processing` on the immediate read; polling would put unbounded latency
    // on an optional section.
    const calls: { method: string; url: string }[] = [];
    mswServer.use(
      http.all(SUMMARIZE_URL, ({ request }) => {
        calls.push({ method: request.method, url: request.url });
        return HttpResponse.json(replaySummaryProcessingFixture);
      }),
    );

    await apiService.getReplaySummary({
      organizationSlug: "sentry-mcp-evals",
      projectSlugOrId: String(replayDetailsFixture.project_id),
      replayId: replayDetailsFixture.id,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
  });

  it("parses a still-running summary without inventing data", async () => {
    mswServer.use(
      http.get(SUMMARIZE_URL, () =>
        HttpResponse.json(replaySummaryProcessingFixture),
      ),
    );

    const summary = await apiService.getReplaySummary({
      organizationSlug: "sentry-mcp-evals",
      projectSlugOrId: String(replayDetailsFixture.project_id),
      replayId: replayDetailsFixture.id,
    });

    expect(summary.status).toBe("processing");
    expect(summary.data).toBeNull();
  });

  it("degrades an unrecognized status to error rather than throwing", async () => {
    // Both sides of this endpoint are experimental, so an unknown status is a
    // reason to omit the section, not to fail the call.
    mswServer.use(
      http.get(SUMMARIZE_URL, () =>
        HttpResponse.json({ data: null, status: "something-new" }),
      ),
    );

    const summary = await apiService.getReplaySummary({
      organizationSlug: "sentry-mcp-evals",
      projectSlugOrId: String(replayDetailsFixture.project_id),
      replayId: replayDetailsFixture.id,
    });

    expect(summary.status).toBe("error");
  });

  it("propagates a 403 so the caller can omit the section", async () => {
    mswServer.use(
      http.get(SUMMARIZE_URL, () =>
        HttpResponse.json(
          {
            detail: "Replay summaries are not available for this organization.",
          },
          { status: 403 },
        ),
      ),
    );

    await expect(
      apiService.getReplaySummary({
        organizationSlug: "sentry-mcp-evals",
        projectSlugOrId: String(replayDetailsFixture.project_id),
        replayId: replayDetailsFixture.id,
      }),
    ).rejects.toThrow();
  });
});
