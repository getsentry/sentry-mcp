/**
 * Replay recording event classification and rendering.
 *
 * This is a port of Sentry's own replay event taxonomy so that MCP output and
 * Sentry's Seer summarizer agree about what a session contains. The upstream
 * sources are:
 *
 * - `sentry/replays/usecases/ingest/event_parser.py` — the `EventType` enum,
 *   the `which()` classifier, and `get_timestamp_unit()`.
 * - `sentry/replays/usecases/summarize.py` — `as_log_message()`, which decides
 *   which events are worth narrating and which are noise.
 *
 * The rules that are easy to get wrong, and why they are what they are:
 *
 * - The SDK emits user actions as rrweb custom events (`type: 5`) tagged
 *   `breadcrumb`, where the meaning lives in `payload.category`. Classifying on
 *   `data.tag` alone labels everything `breadcrumb`.
 * - Timestamp units are a function of event type, not magnitude. Spans and
 *   web vitals are seconds; clicks, console, and navigation are milliseconds.
 * - Dead and rage clicks are not distinct categories. Both arrive as
 *   `ui.slowClickDetected` and are separated behaviorally.
 * - Successful network requests are counted but not narrated.
 *
 * Parsing is deliberately forgiving. Recordings come from many SDK versions and
 * pass through PII scrubbing, which can replace a numeric field with a marker
 * string, so a malformed field degrades that field rather than dropping the
 * event.
 */

import type {
  ReplayRecordingEvent,
  ReplayRecordingPayload,
  ReplayRecordingPayloadData,
  ReplayRecordingSegments,
} from "../api-client";
import { isPlainObject } from "./type-guards";

/**
 * Replay event types, mirroring upstream's `EventType` enum.
 *
 * Names match upstream so the two can be diffed by eye. Upstream's deprecated
 * `FCP` member is omitted.
 */
export type ReplayEventType =
  | "canvas"
  | "click"
  | "console"
  | "dead-click"
  | "feedback"
  | "hydration-error"
  | "lcp"
  | "memory"
  | "mutations"
  | "navigation"
  | "options"
  | "rage-click"
  | "resource-fetch"
  | "resource-image"
  | "resource-script"
  | "resource-xhr"
  | "slow-click"
  | "ui-blur"
  | "ui-focus"
  | "unknown"
  | "cls"
  | "navigation-span"
  | "multi-click"
  | "tap"
  | "device-battery"
  | "device-orientation"
  | "device-connectivity"
  | "scroll"
  | "swipe"
  | "background"
  | "foreground";

/**
 * Caller-facing grouping of event types, used by the `kinds` allow-list.
 *
 * Several event types collapse into one kind — `resource-fetch` and
 * `resource-xhr` are both `network`, and the three device breadcrumbs are all
 * `device` — because callers filter by what happened, not by which SDK API
 * reported it.
 */
export const REPLAY_SIGNAL_KINDS = [
  "navigation",
  "click",
  "dead-click",
  "rage-click",
  "slow-click",
  "network",
  "console",
  "hydration-error",
  "feedback",
  "web-vital",
  "tap",
  "scroll",
  "swipe",
  "app-lifecycle",
  "device",
] as const;

export type ReplaySignalKind = (typeof REPLAY_SIGNAL_KINDS)[number];

export type ReplayGrain = "digest" | "standard" | "detail";

/** A classified, renderable event from a recording. */
export interface ReplaySignal {
  type: ReplayEventType;
  kind: ReplaySignalKind;
  /** Absolute event time in epoch milliseconds, or null when unresolvable. */
  timestampMs: number | null;
  /** Offset from the replay's `started_at`, in milliseconds. */
  offsetMs: number | null;
  /** One-line description of what happened. */
  summary: string;
  /** Extra lines shown only at `detail` grain. */
  details: string[];
  /** True when this signal indicates a failure (error log, failed request). */
  isError: boolean;
  /**
   * rrweb node id of the element this signal is about, when it names one.
   *
   * Kept as data rather than only as a rendered detail line so a caller can
   * hand it to a structural read without parsing it back out of prose.
   */
  nodeId?: number;
}

/** Rendered when the SDK never captured a value. */
export const NOT_CAPTURED = "<not captured>";

/** Rendered when Relay scrubbed a value. */
export const REDACTED = "<redacted>";

/**
 * Relay substitutes this literal for scrubbed values. It is the only
 * server-side redaction marker we can detect; client-side SDK masking leaves
 * no marker at all.
 */
const RELAY_FILTERED_MARKER = "[Filtered]";

/** Upstream truncates console messages and resource URLs at this length. */
const TRUNCATION_LENGTH = 200;

/** A slow click is dead only if the action stalled for at least this long. */
const DEAD_CLICK_THRESHOLD_MS = 7000;

/** A dead click is promoted to a rage click at this many clicks. */
const RAGE_CLICK_THRESHOLD = 5;

/** Only clicks on these elements can be dead — a stalled div is not a defect. */
const INTERACTIVE_TAG_NAMES = new Set(["a", "button", "input"]);

/**
 * Platforms whose replays are mobile, mirroring `MOBILE` in
 * `sentry/utils/platform_categories.py`.
 *
 * This matters for one rule: web replays prefer the navigation *span* and drop
 * the navigation breadcrumb, because the span is unavailable on mobile.
 */
const MOBILE_PLATFORMS = new Set([
  "android",
  "apple-ios",
  "cordova",
  "capacitor",
  "javascript-cordova",
  "javascript-capacitor",
  "ionic",
  "react-native",
  "flutter",
  "dart-flutter",
  "unity",
  "dotnet-maui",
  "dotnet-xamarin",
  "unreal",
  "java-android",
  "cocoa-objc",
  "cocoa-swift",
]);

/** Event types whose outer `timestamp` is in seconds; everything else is ms. */
const SECOND_TIMESTAMP_TYPES = new Set<ReplayEventType>([
  "cls",
  "lcp",
  "memory",
  "mutations",
  "navigation-span",
  "resource-fetch",
  "resource-image",
  "resource-script",
  "resource-xhr",
  "ui-blur",
  "ui-focus",
]);

/** Breadcrumb `payload.category` values, mapped to their event type. */
const CATEGORY_TO_TYPE: Record<string, ReplayEventType> = {
  "ui.click": "click",
  "ui.multiClick": "multi-click",
  navigation: "navigation",
  console: "console",
  "ui.blur": "ui-blur",
  "ui.focus": "ui-focus",
  "replay.hydrate-error": "hydration-error",
  "replay.mutations": "mutations",
  "sentry.feedback": "feedback",
  "ui.tap": "tap",
  "device.battery": "device-battery",
  "device.orientation": "device-orientation",
  "device.connectivity": "device-connectivity",
  "ui.scroll": "scroll",
  "ui.swipe": "swipe",
  "app.background": "background",
  "app.foreground": "foreground",
};

/** Span `payload.op` values, mapped to their event type. */
const OP_TO_TYPE: Record<string, ReplayEventType> = {
  "resource.fetch": "resource-fetch",
  "resource.xhr": "resource-xhr",
  "resource.script": "resource-script",
  "resource.img": "resource-image",
  memory: "memory",
};

const TYPE_TO_KIND: Partial<Record<ReplayEventType, ReplaySignalKind>> = {
  click: "click",
  "dead-click": "dead-click",
  "rage-click": "rage-click",
  "slow-click": "slow-click",
  navigation: "navigation",
  "navigation-span": "navigation",
  "resource-fetch": "network",
  "resource-xhr": "network",
  console: "console",
  "hydration-error": "hydration-error",
  feedback: "feedback",
  lcp: "web-vital",
  cls: "web-vital",
  tap: "tap",
  scroll: "scroll",
  swipe: "swipe",
  background: "app-lifecycle",
  foreground: "app-lifecycle",
  "device-battery": "device",
  "device-orientation": "device",
  "device-connectivity": "device",
};

export function isMobilePlatform(platform?: string | null): boolean {
  return platform ? MOBILE_PLATFORMS.has(platform) : false;
}

/**
 * Identify a replay recording event.
 *
 * Mirrors upstream's `which()`. Anything unrecognized is `unknown` rather than
 * guessed at, so new SDK event types are ignored instead of mislabeled.
 */
export function classifyReplayEvent(
  event: ReplayRecordingEvent,
): ReplayEventType {
  // rrweb incremental snapshot; source 9 is a canvas mutation.
  if (event.type === 3) {
    const source = isPlainObject(event.data) ? event.data.source : undefined;
    return source === 9 ? "canvas" : "unknown";
  }

  if (event.type !== 5) {
    return "unknown";
  }

  const tag = event.data?.tag;
  const payload = event.data?.payload;

  if (tag === "options") {
    return "options";
  }

  if (tag === "breadcrumb") {
    const category = payload?.category;
    if (!category) {
      return "unknown";
    }
    if (category === "ui.slowClickDetected") {
      return classifySlowClick(payload?.data);
    }
    return CATEGORY_TO_TYPE[category] ?? "unknown";
  }

  if (tag === "performanceSpan") {
    const op = payload?.op;
    if (!op) {
      return "unknown";
    }
    // Upstream matches any `navigation*` op, covering navigate, reload,
    // back_forward, and push.
    if (op.startsWith("navigation")) {
      return "navigation-span";
    }
    if (op === "web-vital") {
      if (payload?.description === "largest-contentful-paint") return "lcp";
      if (payload?.description === "cumulative-layout-shift") return "cls";
      return "unknown";
    }
    return OP_TO_TYPE[op] ?? "unknown";
  }

  return "unknown";
}

/**
 * Separate a slow click into slow, dead, or rage.
 *
 * A click is dead when the action it triggered never completed: the SDK timed
 * out (rather than observing a late mutation), the target was interactive, and
 * the stall lasted at least 7 seconds. Repeating the click at least five times
 * makes it a rage click. Anything weaker is a plain slow click, which upstream
 * does not narrate.
 */
function classifySlowClick(data: unknown): ReplayEventType {
  if (!isPlainObject(data)) {
    return "slow-click";
  }

  const node = isPlainObject(data.node) ? data.node : null;
  const tagName =
    typeof node?.tagName === "string" ? node.tagName.toLowerCase() : null;

  // Upstream reads both spellings; some SDKs lowercase payload keys.
  const timeAfterClickMs =
    numberOrZero(data.timeAfterClickMs) || numberOrZero(data.timeafterclickms);

  const isDead =
    data.endReason === "timeout" &&
    tagName !== null &&
    INTERACTIVE_TAG_NAMES.has(tagName) &&
    timeAfterClickMs >= DEAD_CLICK_THRESHOLD_MS;

  if (!isDead) {
    return "slow-click";
  }

  const clickCount =
    numberOrZero(data.clickCount) || numberOrZero(data.clickcount);
  return clickCount >= RAGE_CLICK_THRESHOLD ? "rage-click" : "dead-click";
}

/**
 * Resolve an event's absolute time in epoch milliseconds.
 *
 * The unit comes from the event type. Guessing from magnitude happens to work
 * for present-day epochs but is not a rule, and would silently misplace events
 * for any recording far from now.
 */
export function resolveTimestampMs(
  event: ReplayRecordingEvent,
  type: ReplayEventType,
): number | null {
  const timestamp = event.timestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return null;
  }
  return SECOND_TIMESTAMP_TYPES.has(type) ? timestamp * 1000 : timestamp;
}

/**
 * Convert a recording into classified signals.
 *
 * Noise types are dropped, successful network requests are dropped from the
 * rendered set (callers count them separately), and navigation breadcrumbs are
 * dropped for web replays in favor of the navigation span.
 *
 * Offsets are measured from `startedAt` — the replay's own start — rather than
 * from the first recorded event, so they line up with the replay metadata
 * timeline and with error timestamps resolved elsewhere.
 */
export function extractReplaySignals(
  segments: ReplayRecordingSegments | null,
  {
    startedAt,
    platform,
  }: { startedAt?: string | null; platform?: string | null } = {},
): ReplaySignal[] {
  if (!segments) {
    return [];
  }

  const isMobile = isMobilePlatform(platform);
  const startMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  const originMs = Number.isNaN(startMs) ? null : startMs;
  const signals: ReplaySignal[] = [];

  for (const segment of segments) {
    for (const event of segment) {
      const type = classifyReplayEvent(event);
      const kind = TYPE_TO_KIND[type];
      const summarized = kind ? summarizeEvent(event, type, isMobile) : null;
      if (!summarized || !kind) {
        continue;
      }

      const timestampMs = resolveTimestampMs(event, type);
      signals.push({
        type,
        kind,
        timestampMs,
        offsetMs:
          timestampMs !== null && originMs !== null
            ? timestampMs - originMs
            : null,
        ...summarized,
      });
    }
  }

  return signals;
}

/**
 * Count every classified event by kind, including ones that are not rendered.
 *
 * Successful requests are invisible in the signal list but real in the session,
 * so `network 58 (2 failed)` describes 58 requests of which 2 were narrated.
 */
export interface ReplayKindCount {
  kind: ReplaySignalKind;
  total: number;
  errors: number;
}

export function countReplayKinds(
  segments: ReplayRecordingSegments | null,
): ReplayKindCount[] {
  if (!segments) {
    return [];
  }

  const counts = new Map<ReplaySignalKind, ReplayKindCount>();

  for (const segment of segments) {
    for (const event of segment) {
      const type = classifyReplayEvent(event);
      const kind = TYPE_TO_KIND[type];
      if (!kind) {
        continue;
      }

      const entry = counts.get(kind) ?? { kind, total: 0, errors: 0 };
      entry.total += 1;
      if (isErrorEvent(event, type)) {
        entry.errors += 1;
      }
      counts.set(kind, entry);
    }
  }

  return [...counts.values()];
}

/**
 * Format a millisecond offset as `T+1m 23.4s`.
 *
 * Sub-second precision is kept because replay failures cluster: a click, its
 * request, and the resulting console error can land inside the same second,
 * and rounding them together loses the ordering that explains the failure.
 */
export function formatReplayOffset(offsetMs: number | null): string {
  if (offsetMs === null) {
    return "T+?";
  }

  const totalSeconds = Math.max(0, offsetMs) / 1000;
  if (totalSeconds < 60) {
    return `T+${totalSeconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `T+${minutes}m ${seconds.toFixed(1)}s`;
}

/**
 * Render signals at the requested grain.
 *
 * `digest` answers "what kind of session was this" in a handful of lines,
 * `standard` lists what happened, and `detail` adds the payload needed to act
 * on a specific failure. Grain controls rendering only — filtering is the
 * caller's job, so a digest of a filtered window stays consistent with the
 * standard rendering of the same window.
 */
export function renderReplaySignals(
  signals: ReplaySignal[],
  grain: ReplayGrain = "standard",
): string[] {
  if (signals.length === 0) {
    return [];
  }

  if (grain === "digest") {
    return renderDigest(signals);
  }

  const lines: string[] = [];
  for (const [index, signal] of signals.entries()) {
    const repeats = grain === "standard" ? countRepeats(signals, index) : 0;
    if (repeats < 0) {
      continue;
    }

    const suffix = repeats > 1 ? ` ×${repeats}` : "";
    lines.push(
      `${formatReplayOffset(signal.offsetMs)}  ${signal.kind}  ${signal.summary}${suffix}`,
    );

    if (grain === "detail") {
      for (const detail of signal.details) {
        lines.push(`    ${detail}`);
      }
    }
  }

  return lines;
}

/**
 * One rollup line per kind, in first-appearance order.
 */
function renderDigest(signals: ReplaySignal[]): string[] {
  const counts = new Map<ReplaySignalKind, { total: number; errors: number }>();

  for (const signal of signals) {
    const entry = counts.get(signal.kind) ?? { total: 0, errors: 0 };
    entry.total += 1;
    if (signal.isError) {
      entry.errors += 1;
    }
    counts.set(signal.kind, entry);
  }

  return [...counts.entries()].map(([kind, { total, errors }]) =>
    errors > 0 ? `${kind} ×${total} (${errors} failed)` : `${kind} ×${total}`,
  );
}

/**
 * Collapse a run of identical consecutive signals.
 *
 * Returns the run length at its first element, and -1 for the rest so callers
 * skip them. A user clicking the same dead button nine times is one fact, not
 * nine lines.
 */
function countRepeats(signals: ReplaySignal[], index: number): number {
  const signal = signals[index];
  const previous = signals[index - 1];
  if (previous && isSameSignal(previous, signal)) {
    return -1;
  }

  let count = 1;
  while (
    index + count < signals.length &&
    isSameSignal(signals[index + count], signal)
  ) {
    count += 1;
  }
  return count;
}

function isSameSignal(a: ReplaySignal, b: ReplaySignal): boolean {
  return a.kind === b.kind && a.summary === b.summary;
}

function isErrorEvent(
  event: ReplayRecordingEvent,
  type: ReplayEventType,
): boolean {
  if (type === "console") {
    return event.data?.payload?.level === "error";
  }
  if (type === "resource-fetch" || type === "resource-xhr") {
    const status = event.data?.payload?.data?.statusCode;
    return typeof status === "number" && status >= 400;
  }
  return type === "hydration-error";
}

type SummarizedEvent = Pick<
  ReplaySignal,
  "summary" | "details" | "isError" | "nodeId"
>;

/**
 * Describe an event, or return null when it should not be rendered.
 *
 * The exclusion list mirrors upstream's `as_log_message` returning `None`:
 * options, memory, mutations, canvas, script and image resources, blur, focus,
 * CLS, plain slow clicks, and multi-clicks are all noise.
 */
function summarizeEvent(
  event: ReplayRecordingEvent,
  type: ReplayEventType,
  isMobile: boolean,
): SummarizedEvent | null {
  const payload = event.data?.payload;
  const data = payload?.data;

  switch (type) {
    case "click":
      return describeClick(payload?.message, data, "Clicked");
    case "dead-click":
      return describeClick(
        payload?.message,
        data,
        "Dead click — no response from",
      );
    case "rage-click":
      return describeClick(payload?.message, data, "Rage click on");

    case "navigation-span":
      // Web prefers the span; mobile has no span to prefer.
      if (isMobile) return null;
      return {
        summary: `Navigated to ${formatUrl(payload?.description)}`,
        details: [],
        isError: false,
      };

    case "navigation":
      // Mirror image of the rule above: web drops the breadcrumb.
      if (!isMobile) return null;
      return {
        summary: data?.to ? `Navigated to ${formatUrl(data.to)}` : "Navigated",
        details: [],
        isError: false,
      };

    case "console": {
      const level = payload?.level ?? "log";
      const message = truncate(redactable(payload?.message) ?? "");
      return {
        summary: `Console ${level}: ${message}`,
        details: [],
        isError: level === "error",
      };
    }

    case "resource-fetch":
    case "resource-xhr":
      return describeNetworkRequest(payload, type);

    case "hydration-error":
      return {
        summary: "Hydration error on the page",
        details: data?.url ? [`url: ${formatUrl(data.url)}`] : [],
        isError: true,
      };

    case "feedback":
      return {
        summary: "User submitted feedback",
        details: [],
        isError: false,
      };

    case "lcp": {
      const size = data?.size;
      const rating = data?.rating;
      // A paint that met its threshold is not an event worth a line beside a
      // failed request or a rage click. Rendering it as a peer invites an agent
      // to investigate a metric that is already fine; the count remains
      // available through `countReplayKinds`.
      if (rating === "good") {
        return null;
      }
      return {
        summary:
          size != null && rating != null
            ? `Largest contentful paint: ${size}ms (${rating})`
            : "Largest contentful paint",
        details: [],
        isError: false,
      };
    }

    case "tap": {
      const message = redactable(payload?.message);
      // Upstream drops taps with no target.
      if (!message) return null;
      return { summary: `Tapped ${message}`, details: [], isError: false };
    }

    case "scroll":
    case "swipe": {
      const verb = type === "scroll" ? "Scrolled" : "Swiped";
      const target = [data?.["view.id"], data?.direction]
        .filter(Boolean)
        .join(" ");
      return {
        summary: target ? `${verb} ${target}` : verb,
        details: [],
        isError: false,
      };
    }

    case "background":
      return {
        summary: "App moved to background",
        details: [],
        isError: false,
      };
    case "foreground":
      return {
        summary: "App moved to foreground",
        details: [],
        isError: false,
      };

    case "device-battery": {
      const level = data?.level;
      const charging = data?.charging;
      return {
        summary:
          level != null && charging != null
            ? `Battery ${level}%, ${charging ? "charging" : "not charging"}`
            : "Battery status changed",
        details: [],
        isError: false,
      };
    }
    case "device-orientation":
      return {
        summary: data?.position
          ? `Orientation changed to ${data.position}`
          : "Orientation changed",
        details: [],
        isError: false,
      };
    case "device-connectivity":
      return {
        summary: data?.state
          ? `Connectivity changed to ${data.state}`
          : "Connectivity changed",
        details: [],
        isError: false,
      };

    // Noise. Upstream returns None for all of these.
    default:
      return null;
  }
}

function describeClick(
  message: string | undefined,
  data: ReplayRecordingPayloadData | undefined,
  verb: string,
): SummarizedEvent {
  const target = redactable(message) ?? describeNode(data) ?? "element";
  const details: string[] = [];

  const text =
    typeof data?.node?.textContent === "string"
      ? data.node.textContent.trim()
      : "";
  if (text) {
    details.push(`text: ${truncate(text)}`);
  }

  const timeAfterClickMs =
    numberOrZero(data?.timeAfterClickMs) ||
    numberOrZero(data?.timeafterclickms);
  if (timeAfterClickMs > 0) {
    details.push(`stalled: ${timeAfterClickMs}ms (${data?.endReason})`);
  }

  const clickCount =
    numberOrZero(data?.clickCount) || numberOrZero(data?.clickcount);
  if (clickCount > 1) {
    details.push(`clicks: ${clickCount}`);
  }

  // The rrweb node id, which is the handle a DOM read roots at. Reported
  // because it is otherwise unreachable: it is stable within a recording, but
  // nothing else in this output names it, so "show me the DOM around what was
  // clicked" would have no way to say which element.
  const nodeId = typeof data?.node?.id === "number" ? data.node.id : undefined;
  if (nodeId !== undefined) {
    details.push(`nodeId: ${nodeId}`);
  }

  return {
    summary: `${verb} ${target}`,
    details,
    // A dead or rage click is a failure of the page, not of the request.
    isError: verb !== "Clicked",
    nodeId,
  };
}

/**
 * Describe a network request.
 *
 * Successful requests return null: upstream narrates only failures, and callers
 * that need the full count use `countReplayKinds`. A request with no status at
 * all never got a response, which is itself worth reporting.
 */
function describeNetworkRequest(
  payload: ReplayRecordingPayload | undefined,
  type: ReplayEventType,
): SummarizedEvent | null {
  const data = payload?.data;
  const statusCode = data?.statusCode;

  if (typeof statusCode === "number" && statusCode >= 200 && statusCode < 300) {
    return null;
  }

  const label = type === "resource-fetch" ? "Fetch" : "XHR";
  const method = data?.method;
  const url = formatUrl(payload?.description);
  const request = method ? `${method} ${url}` : url;
  const status = statusCode != null ? String(statusCode) : "no response";

  // Duration belongs in the summary, not the detail lines: how long a failing
  // request took is often the difference between a rejected call and a timeout,
  // and it is the first thing asked about a slow page. It was previously read
  // from `data.duration`, which the SDK never sets — `NetworkRequestData` has no
  // such field — so the line silently never rendered.
  const durationMs = spanDurationMs(payload);
  const timing = durationMs !== null ? ` in ${formatDuration(durationMs)}` : "";

  const details: string[] = [];
  details.push(
    `request body: ${describeBody(data?.request, data?.requestBodySize)}`,
  );
  details.push(
    `response body: ${describeBody(data?.response, data?.responseBodySize)}`,
  );

  return {
    summary: `${label} ${request} failed with ${status}${timing}`,
    details,
    isError: true,
  };
}

/**
 * Elapsed time of a span frame, in milliseconds.
 *
 * Span frames carry `startTimestamp`/`endTimestamp` in seconds — verified
 * against `ReplayBaseSpanFrame` in `@sentry-internal/replay` — and no duration
 * field of their own. Returns null rather than zero when either bound is
 * missing, so an unknown duration is not reported as instant.
 */
function spanDurationMs(
  payload: ReplayRecordingPayload | undefined,
): number | null {
  const start = payload?.startTimestamp;
  const end = payload?.endTimestamp;
  if (typeof start !== "number" || typeof end !== "number") {
    return null;
  }
  const elapsed = (end - start) * 1000;
  return elapsed >= 0 ? elapsed : null;
}

/**
 * Render a millisecond duration at a precision that stays readable.
 *
 * Sub-second timings are the common case and matter to the millisecond;
 * anything longer is about magnitude, not precision.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Describe a captured request or response body.
 *
 * Absence is reported rather than passed over in silence: `networkCaptureBodies`
 * is opt-in, so a missing body usually means the SDK was never asked to record
 * one, and saying nothing would imply we could have retrieved it.
 */
function describeBody(
  body: { size?: number; body?: unknown } | undefined,
  legacySize: number | undefined,
): string {
  const value = body?.body;
  if (typeof value === "string") {
    return value === RELAY_FILTERED_MARKER ? REDACTED : truncate(value);
  }

  const size = body?.size ?? legacySize;
  if (typeof size === "number") {
    return `${size} bytes ${NOT_CAPTURED}`;
  }
  return NOT_CAPTURED;
}

function describeNode(data: unknown): string | null {
  if (!isPlainObject(data) || !isPlainObject(data.node)) {
    return null;
  }
  const tagName =
    typeof data.node.tagName === "string" ? data.node.tagName : null;
  if (!tagName) {
    return null;
  }
  const attributes = isPlainObject(data.node.attributes)
    ? data.node.attributes
    : {};
  const id = typeof attributes.id === "string" ? `#${attributes.id}` : "";
  return `${tagName.toLowerCase()}${id}`;
}

/**
 * Report a value as redacted only when Relay says so.
 *
 * Client-side SDK masking leaves no marker — a masked string is
 * indistinguishable from a real one — so masked values are rendered as
 * delivered. Guessing would be worse than silence: a wrong `<redacted>` tells
 * the reader content exists behind a mask when it may be the recorded value.
 */
function redactable(value: string | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return value === RELAY_FILTERED_MARKER ? REDACTED : value.trim();
}

/**
 * Shorten a URL to `host/path?query`, matching upstream's `_parse_url`.
 */
function formatUrl(value: string | undefined): string {
  if (typeof value !== "string" || !value) {
    return "unknown";
  }
  if (value === RELAY_FILTERED_MARKER) {
    return REDACTED;
  }

  try {
    const url = new URL(value);
    const path = url.pathname.replace(/^\//, "");
    return `${url.host}/${path}${url.search}`;
  } catch {
    return truncate(value);
  }
}

function truncate(value: string): string {
  return value.length > TRUNCATION_LENGTH
    ? `${value.slice(0, TRUNCATION_LENGTH)} [truncated]`
    : value;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
