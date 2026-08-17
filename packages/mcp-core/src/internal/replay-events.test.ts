import { describe, expect, it } from "vitest";
import { replayRecordingSegmentsFixture } from "@sentry/mcp-server-mocks";
import type { ReplayRecordingSegments } from "../api-client";
import {
  NOT_CAPTURED,
  REDACTED,
  classifyReplayEvent,
  countReplayKinds,
  extractReplaySignals,
  formatReplayOffset,
  isMobilePlatform,
  renderReplaySignals,
  resolveTimestampMs,
} from "./replay-events.js";

const SESSION_START = "2025-04-07T12:00:00.000Z";
const SESSION_START_MS = Date.parse(SESSION_START);

/** Build a breadcrumb custom event as the SDK emits it. */
function breadcrumb(
  category: string,
  payload: Record<string, unknown> = {},
  timestampMs = SESSION_START_MS,
) {
  return {
    type: 5,
    timestamp: timestampMs,
    data: {
      tag: "breadcrumb",
      payload: { type: "default", category, ...payload },
    },
  };
}

/** Build a performance span custom event. Span timestamps are in seconds. */
function span(
  op: string,
  payload: Record<string, unknown> = {},
  timestampSeconds = SESSION_START_MS / 1000,
) {
  return {
    type: 5,
    timestamp: timestampSeconds,
    data: { tag: "performanceSpan", payload: { op, ...payload } },
  };
}

/** Run events through the schema so tests exercise real parsed shapes. */
function signalsFrom(
  events: unknown[],
  options: { platform?: string } = {},
): ReturnType<typeof extractReplaySignals> {
  return extractReplaySignals([events] as ReplayRecordingSegments, {
    startedAt: SESSION_START,
    platform: options.platform ?? "javascript",
  });
}

function slowClick(data: Record<string, unknown>) {
  return breadcrumb("ui.slowClickDetected", {
    message: "button#submit",
    data: {
      node: { id: 1, tagName: "button", textContent: "Submit", attributes: {} },
      ...data,
    },
  });
}

describe("classifyReplayEvent", () => {
  it("classifies breadcrumbs by payload.category, not by tag", () => {
    // The whole point of the port: `data.tag` is always "breadcrumb", so
    // classifying on it collapses every user action into one label.
    expect(classifyReplayEvent(breadcrumb("ui.click") as never)).toBe("click");
    expect(classifyReplayEvent(breadcrumb("console") as never)).toBe("console");
    expect(classifyReplayEvent(breadcrumb("navigation") as never)).toBe(
      "navigation",
    );
    expect(
      classifyReplayEvent(breadcrumb("replay.hydrate-error") as never),
    ).toBe("hydration-error");
    expect(classifyReplayEvent(breadcrumb("sentry.feedback") as never)).toBe(
      "feedback",
    );
    expect(classifyReplayEvent(breadcrumb("ui.multiClick") as never)).toBe(
      "multi-click",
    );
  });

  it("classifies mobile breadcrumb categories", () => {
    expect(classifyReplayEvent(breadcrumb("ui.tap") as never)).toBe("tap");
    expect(classifyReplayEvent(breadcrumb("ui.scroll") as never)).toBe(
      "scroll",
    );
    expect(classifyReplayEvent(breadcrumb("ui.swipe") as never)).toBe("swipe");
    expect(classifyReplayEvent(breadcrumb("app.background") as never)).toBe(
      "background",
    );
    expect(classifyReplayEvent(breadcrumb("device.battery") as never)).toBe(
      "device-battery",
    );
  });

  it("classifies performance spans by op", () => {
    expect(classifyReplayEvent(span("resource.fetch") as never)).toBe(
      "resource-fetch",
    );
    expect(classifyReplayEvent(span("resource.xhr") as never)).toBe(
      "resource-xhr",
    );
    expect(classifyReplayEvent(span("resource.script") as never)).toBe(
      "resource-script",
    );
    expect(classifyReplayEvent(span("memory") as never)).toBe("memory");
  });

  it("treats every navigation* op as a navigation span", () => {
    // Upstream matches on prefix, covering navigate, reload, back_forward,
    // and the SPA-only navigation.push.
    for (const op of [
      "navigation.navigate",
      "navigation.reload",
      "navigation.back_forward",
      "navigation.push",
    ]) {
      expect(classifyReplayEvent(span(op) as never)).toBe("navigation-span");
    }
  });

  it("splits web vitals by description", () => {
    expect(
      classifyReplayEvent(
        span("web-vital", { description: "largest-contentful-paint" }) as never,
      ),
    ).toBe("lcp");
    expect(
      classifyReplayEvent(
        span("web-vital", { description: "cumulative-layout-shift" }) as never,
      ),
    ).toBe("cls");
    expect(
      classifyReplayEvent(
        span("web-vital", { description: "first-input-delay" }) as never,
      ),
    ).toBe("unknown");
  });

  it("classifies options events and canvas mutations", () => {
    expect(
      classifyReplayEvent({
        type: 5,
        timestamp: 1,
        data: { tag: "options", payload: {} },
      } as never),
    ).toBe("options");
    expect(
      classifyReplayEvent({
        type: 3,
        timestamp: 1,
        data: { source: 9 },
      } as never),
    ).toBe("canvas");
    expect(
      classifyReplayEvent({
        type: 3,
        timestamp: 1,
        data: { source: 2 },
      } as never),
    ).toBe("unknown");
  });

  it("returns unknown rather than guessing at unrecognized events", () => {
    expect(classifyReplayEvent(breadcrumb("ui.somethingNew") as never)).toBe(
      "unknown",
    );
    expect(classifyReplayEvent(span("resource.websocket") as never)).toBe(
      "unknown",
    );
    // A full snapshot (type 4) carries no activity.
    expect(
      classifyReplayEvent({
        type: 4,
        timestamp: 1,
        data: { href: "/" },
      } as never),
    ).toBe("unknown");
  });
});

describe("dead and rage click classification", () => {
  it("classifies a rage click at the clickCount threshold", () => {
    expect(
      classifyReplayEvent(
        slowClick({
          endReason: "timeout",
          timeAfterClickMs: 7000,
          clickCount: 5,
        }) as never,
      ),
    ).toBe("rage-click");
  });

  it("stays a dead click one click below the rage threshold", () => {
    expect(
      classifyReplayEvent(
        slowClick({
          endReason: "timeout",
          timeAfterClickMs: 7000,
          clickCount: 4,
        }) as never,
      ),
    ).toBe("dead-click");
  });

  it("is dead at exactly 7000ms and merely slow at 6999ms", () => {
    // The boundary is inclusive upstream; off-by-one here would silently
    // reclassify a whole category of clicks.
    expect(
      classifyReplayEvent(
        slowClick({ endReason: "timeout", timeAfterClickMs: 7000 }) as never,
      ),
    ).toBe("dead-click");
    expect(
      classifyReplayEvent(
        slowClick({ endReason: "timeout", timeAfterClickMs: 6999 }) as never,
      ),
    ).toBe("slow-click");
  });

  it("requires a timeout, not a late mutation", () => {
    // endReason "mutation" means the page did respond, just slowly.
    expect(
      classifyReplayEvent(
        slowClick({
          endReason: "mutation",
          timeAfterClickMs: 9000,
          clickCount: 9,
        }) as never,
      ),
    ).toBe("slow-click");
  });

  it("requires an interactive target", () => {
    const onDiv = breadcrumb("ui.slowClickDetected", {
      message: "div#panel",
      data: {
        node: { id: 2, tagName: "div", textContent: "", attributes: {} },
        endReason: "timeout",
        timeAfterClickMs: 9000,
        clickCount: 9,
      },
    });
    expect(classifyReplayEvent(onDiv as never)).toBe("slow-click");

    for (const tagName of ["a", "button", "input"]) {
      const event = breadcrumb("ui.slowClickDetected", {
        message: `${tagName}#target`,
        data: {
          node: { id: 3, tagName, textContent: "", attributes: {} },
          endReason: "timeout",
          timeAfterClickMs: 7000,
        },
      });
      expect(classifyReplayEvent(event as never)).toBe("dead-click");
    }
  });

  it("accepts the lowercase payload spellings", () => {
    // Some SDKs lowercase payload keys; upstream reads both.
    expect(
      classifyReplayEvent(
        slowClick({
          endReason: "timeout",
          timeafterclickms: 7000,
          clickcount: 5,
        }) as never,
      ),
    ).toBe("rage-click");
  });

  it("falls back to slow when the payload has no data at all", () => {
    expect(
      classifyReplayEvent(breadcrumb("ui.slowClickDetected") as never),
    ).toBe("slow-click");
  });
});

describe("resolveTimestampMs", () => {
  it("reads span timestamps as seconds", () => {
    const event = span("resource.fetch", {}, 1744027213.1);
    expect(resolveTimestampMs(event as never, "resource-fetch")).toBe(
      1744027213100,
    );
  });

  it("reads breadcrumb timestamps as milliseconds", () => {
    const event = breadcrumb("ui.click", {}, 1744027212400);
    expect(resolveTimestampMs(event as never, "click")).toBe(1744027212400);
  });

  it("uses the event type rather than the value's magnitude", () => {
    // A 1970s recording has a small ms timestamp. Magnitude-based guessing
    // would read it as seconds and misplace it by decades.
    const event = breadcrumb("ui.click", {}, 5000);
    expect(resolveTimestampMs(event as never, "click")).toBe(5000);
    expect(resolveTimestampMs(event as never, "resource-fetch")).toBe(5000000);
  });

  it("returns null when scrubbing removed the timestamp", () => {
    const scrubbed = { type: 5, data: { tag: "breadcrumb" } };
    expect(resolveTimestampMs(scrubbed as never, "click")).toBeNull();
  });
});

describe("noise exclusion", () => {
  it("drops the event types upstream refuses to narrate", () => {
    const noise = [
      {
        type: 5,
        timestamp: SESSION_START_MS,
        data: { tag: "options", payload: {} },
      },
      span("memory"),
      span("resource.script", { description: "https://cdn.example.com/a.js" }),
      span("resource.img", { description: "https://cdn.example.com/a.png" }),
      span("web-vital", { description: "cumulative-layout-shift" }),
      breadcrumb("replay.mutations"),
      breadcrumb("ui.blur"),
      breadcrumb("ui.focus"),
      breadcrumb("ui.multiClick", { data: { clickCount: 3 } }),
      slowClick({ endReason: "mutation", timeAfterClickMs: 100 }),
      { type: 3, timestamp: SESSION_START_MS, data: { source: 9 } },
    ];

    expect(signalsFrom(noise)).toEqual([]);
  });

  it("counts successful requests but does not render them", () => {
    const events = [
      span("resource.fetch", {
        description: "https://example.com/api/ok",
        data: { method: "GET", statusCode: 200 },
      }),
      span("resource.fetch", {
        description: "https://example.com/api/fail",
        data: { method: "POST", statusCode: 500 },
      }),
    ];

    const signals = signalsFrom(events);
    expect(signals).toHaveLength(1);
    expect(signals[0].summary).toContain("500");

    // The successful request is invisible in the signal list but real in the
    // session, so the count must still see both.
    const network = countReplayKinds([events] as ReplayRecordingSegments).find(
      (entry) => entry.kind === "network",
    );
    expect(network).toEqual({ kind: "network", total: 2, errors: 1 });
  });

  it("reports a request that never got a response", () => {
    // CORS failures arrive with no method and no statusCode.
    const signals = signalsFrom([
      span("resource.fetch", { description: "https://other.example.com/x" }),
    ]);
    expect(signals[0].summary).toBe(
      "Fetch other.example.com/x failed with no response",
    );
    expect(signals[0].isError).toBe(true);
  });
});

describe("web versus mobile navigation", () => {
  const events = [
    breadcrumb("navigation", { data: { from: "/login", to: "/checkout" } }),
    span("navigation.navigate", {
      description: "https://example.com/checkout",
    }),
  ];

  it("prefers the navigation span on web", () => {
    const signals = signalsFrom(events, { platform: "javascript" });
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe("navigation-span");
    expect(signals[0].summary).toBe("Navigated to example.com/checkout");
  });

  it("uses the navigation breadcrumb on mobile, where no span exists", () => {
    const signals = signalsFrom(events, { platform: "android" });
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe("navigation");
    expect(signals[0].summary).toBe("Navigated to /checkout");
  });

  it("recognizes the mobile platform list", () => {
    expect(isMobilePlatform("react-native")).toBe(true);
    expect(isMobilePlatform("apple-ios")).toBe(true);
    expect(isMobilePlatform("javascript")).toBe(false);
    expect(isMobilePlatform(null)).toBe(false);
  });
});

describe("offsets", () => {
  it("measures from the replay's started_at, not the first event", () => {
    // The first recorded event here is 12s in; offsets must reflect that
    // rather than resetting to zero.
    const signals = signalsFrom([
      breadcrumb(
        "ui.click",
        { message: "button#a" },
        SESSION_START_MS + 12_000,
      ),
      breadcrumb(
        "ui.click",
        { message: "button#b" },
        SESSION_START_MS + 20_000,
      ),
    ]);

    expect(signals.map((signal) => signal.offsetMs)).toEqual([12_000, 20_000]);
  });

  it("yields a null offset when the session start is unknown", () => {
    const signals = extractReplaySignals(
      [
        [breadcrumb("ui.click", { message: "button#a" })],
      ] as ReplayRecordingSegments,
      { startedAt: null },
    );
    expect(signals[0].offsetMs).toBeNull();
  });

  it("formats offsets with sub-second precision", () => {
    // Failures cluster inside a single second; rounding loses the ordering.
    expect(formatReplayOffset(0)).toBe("T+0.0s");
    expect(formatReplayOffset(311_800)).toBe("T+5m 11.8s");
    expect(formatReplayOffset(59_900)).toBe("T+59.9s");
    expect(formatReplayOffset(60_000)).toBe("T+1m 0.0s");
    expect(formatReplayOffset(null)).toBe("T+?");
  });
});

describe("redaction labeling", () => {
  it("marks an uncaptured body as not captured", () => {
    // networkCaptureBodies is opt-in, so absence is the common case and
    // silence would imply the content was retrievable.
    const signals = signalsFrom([
      span("resource.fetch", {
        description: "https://example.com/api/checkout",
        data: { method: "POST", statusCode: 500 },
      }),
    ]);
    expect(signals[0].details).toContain(`request body: ${NOT_CAPTURED}`);
    expect(signals[0].details).toContain(`response body: ${NOT_CAPTURED}`);
  });

  it("reports a known body size that was not captured", () => {
    const signals = signalsFrom([
      span("resource.fetch", {
        description: "https://example.com/api/checkout",
        data: {
          method: "POST",
          statusCode: 500,
          request: { size: 214, headers: {} },
        },
      }),
    ]);
    expect(signals[0].details).toContain(
      `request body: 214 bytes ${NOT_CAPTURED}`,
    );
  });

  it("marks Relay-scrubbed values as redacted", () => {
    const signals = signalsFrom([
      span("resource.fetch", {
        description: "https://example.com/api/checkout",
        data: {
          method: "POST",
          statusCode: 500,
          request: { size: 8, body: "[Filtered]" },
        },
      }),
    ]);
    expect(signals[0].details).toContain(`request body: ${REDACTED}`);
  });

  it("renders client-masked values as delivered", () => {
    // SDK masking leaves no marker, so claiming redaction would assert
    // something we cannot know.
    const signals = signalsFrom([
      breadcrumb("ui.click", { message: "input#card[value=****]" }),
    ]);
    expect(signals[0].summary).toBe("Clicked input#card[value=****]");
    expect(signals[0].summary).not.toContain(REDACTED);
  });
});

describe("rendering grains", () => {
  const events = [
    breadcrumb(
      "ui.click",
      { message: "button#complete-order" },
      SESSION_START_MS + 180_600,
    ),
    span(
      "resource.fetch",
      {
        description: "https://example.com/api/checkout",
        data: { method: "POST", statusCode: 500, duration: 1240 },
      },
      (SESSION_START_MS + 181_000) / 1000,
    ),
    breadcrumb(
      "console",
      { level: "error", message: "TypeError: Cannot read 'id' of undefined" },
      SESSION_START_MS + 181_300,
    ),
  ];

  it("renders one rollup line per kind at digest grain", () => {
    expect(renderReplaySignals(signalsFrom(events), "digest")).toEqual([
      "click ×1",
      "network ×1 (1 failed)",
      "console ×1 (1 failed)",
    ]);
  });

  it("renders one line per signal at standard grain", () => {
    expect(renderReplaySignals(signalsFrom(events), "standard")).toEqual([
      "T+3m 0.6s  click  Clicked button#complete-order",
      "T+3m 1.0s  network  Fetch POST example.com/api/checkout failed with 500",
      "T+3m 1.3s  console  Console error: TypeError: Cannot read 'id' of undefined",
    ]);
  });

  it("adds payload lines at detail grain", () => {
    const lines = renderReplaySignals(signalsFrom(events), "detail");
    expect(lines).toContain("    duration: 1240ms");
    expect(lines).toContain(`    request body: ${NOT_CAPTURED}`);
  });

  it("merges repeated signals at standard grain", () => {
    const repeated = Array.from({ length: 3 }, (_, index) =>
      breadcrumb(
        "ui.click",
        { message: "button#retry" },
        SESSION_START_MS + index * 1000,
      ),
    );
    expect(renderReplaySignals(signalsFrom(repeated), "standard")).toEqual([
      "T+0.0s  click  Clicked button#retry ×3",
    ]);
  });

  it("returns nothing for an empty signal list", () => {
    expect(renderReplaySignals([], "standard")).toEqual([]);
    expect(renderReplaySignals([], "digest")).toEqual([]);
  });
});

describe("against the recorded fixture", () => {
  const signals = extractReplaySignals(
    replayRecordingSegmentsFixture as ReplayRecordingSegments,
    { startedAt: SESSION_START, platform: "javascript" },
  );

  it("surfaces the failure the old classifier dropped", () => {
    // The six-event cap previously spent its budget on session-boot noise and
    // never reached any of these.
    const summaries = signals.map((signal) => signal.summary);
    expect(summaries).toEqual([
      "Navigated to example.com/login",
      "Clicked body > div#root > form#login > button#sign-in",
      "Navigated to example.com/checkout",
      "Clicked body > div#root > main > button#complete-order",
      "Fetch POST example.com/api/checkout failed with 500",
      "Console error: TypeError: Cannot read properties of undefined (reading 'id')",
      "Rage click on body > div#root > main > button#complete-order",
      "Dead click — no response from body > div#root > main > a#download-receipt",
    ]);
  });

  it("keeps the successful login request out of the rendered signals", () => {
    expect(
      signals.filter((signal) => signal.summary.includes("api/login")),
    ).toEqual([]);
  });

  it("counts both requests including the successful one", () => {
    expect(
      countReplayKinds(
        replayRecordingSegmentsFixture as ReplayRecordingSegments,
      ),
    ).toEqual(
      expect.arrayContaining([
        { kind: "network", total: 2, errors: 1 },
        { kind: "console", total: 1, errors: 1 },
      ]),
    );
  });

  it("orders the checkout failure by its true offsets", () => {
    const checkout = signals.slice(3, 6).map((signal) => ({
      offsetMs: signal.offsetMs,
      kind: signal.kind,
    }));
    // Click, then request, then the resulting console error — all inside one
    // second, which is exactly why sub-second offsets matter.
    expect(checkout).toEqual([
      { offsetMs: 180_600, kind: "click" },
      { offsetMs: 181_000, kind: "network" },
      { offsetMs: 181_300, kind: "console" },
    ]);
  });
});
