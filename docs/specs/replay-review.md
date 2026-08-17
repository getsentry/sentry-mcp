# Replay Review Specification

## Overview

Replay retrieval today returns a single fixed-grain summary capped at six
activity events. Agents cannot narrow to a time window, cannot request more or
less detail, and cannot tell truncation from absence. The cap is spent on
session-boot noise before the failure is reached.

This spec restructures replay retrieval around three ideas:

1. **Map before detail** — `get_replay_details` returns the shape of a session
   (signal counts, page flow, error markers), not a prose sample of it.
2. **Windowed zoom** — a new catalog tool, `get_replay_activity`, returns
   signals for a requested time window at a requested grain.
3. **Sentry's own taxonomy** — classify and phrase replay events the way
   `sentry.replays.usecases.summarize` does, so MCP output matches what Sentry's
   Seer summarizer sees.

`replayId` plus a time window is the navigation handle. No server-side session
state is introduced.

## Motivation

### The current output is wrong, not merely terse

Sentry's SDK emits user actions as rrweb custom events with
`data.tag === "breadcrumb"`, where the meaning lives in `payload.category`
(`ui.click`, `console`, `navigation`, `ui.slowClickDetected`). See "References"
below for the upstream spec and SDK types.

`summarizeTaggedReplayEvent` in
`packages/mcp-core/src/tools/catalog/get-replay-details.ts` special-cases
`tag === "ui.click"` — a shape the SDK never produces. Feeding realistically
shaped segments through the current handler produces:

```text
- T+0s      · `options`         · payload="sessionSampleRate=0.1, errorSampleRate=1"
- T+0s      · `page.view`       · href=https://example.com/checkout
- T+1s      · `resource.script` · description=https://cdn.example.com/vendor.js
- T+5m 12s  · `breadcrumb` · message="button#complete-order[...]" · category="ui.click" · type="default" · payload="timestamp=1744027511.8"
- T+5m 12s  · `resource.fetch`  · description=https://example.com/api/checkout
- T+5m 12s  · `breadcrumb` · message="TypeError: Cannot read 'id' of undefined" · category="console" · type="default" · payload="timestamp=1744027512.09"
```

Four defects, none caught by existing tests:

- Every user action is labeled `breadcrumb`; the real signal is demoted into a
  details blob beside `type="default"` and a raw epoch timestamp.
- Half the six-event budget goes to `options` (which leaks sample rates), a
  `<meta>` href, and a vendor script fetch.
- A `ui.slowClickDetected` rage click was dropped by the cap at 11 input events.
  Real sessions contain thousands.
- `packages/mcp-server-mocks/src/fixtures/replay-recording-segments.json` uses
  `tag: "ui.click"`, so snapshots look correct while real output degrades. No
  replay eval exists.

### The API supports more than we ask of it

Verified against Sentry source and public API docs:

- `getReplayRecordingSegments` (`packages/mcp-core/src/api-client/client.ts`)
  sends only `?download=true`. That parameter **does not exist on the segments
  index endpoint**, which always downloads. Meanwhile `cursor` is omitted, so
  replays longer than 100 segments are silently truncated. Note that `per_page`
  is not the fix: its default *and* maximum are both 100, so only following the
  `Link` header's cursor reaches later segments.
- The org replays index accepts a `field` allow-list, which `searchReplays` does
  not send at all, so Sentry returns its default column set. Any allow-list must
  be drawn from `VALID_FIELD_SET` in `sentry/replays/validators.py`, whose names
  are coarser than the discovery list (`browser`, `user`, `device`, `sdk`,
  `releases`, `trace_ids` — not `browser.name`).
- `POST`/`GET /projects/{org}/{project}/replays/{replay_id}/summarize/` exists
  and returns a narrative plus chapters, but is unused.

## Upstream Building Blocks

`sentry.replays.usecases.ingest.event_parser` defines a 32-member `EventType`
enum and a `which()` classifier keyed on `payload.category` and span `op`.
`sentry.replays.usecases.summarize.as_log_message` converts each type into
agent-facing prose and returns `None` for noise.

Behavior worth porting rather than reinventing:

- Dropped entirely: `OPTIONS`, `MEMORY`, `MUTATIONS`, `CANVAS`,
  `RESOURCE_SCRIPT`, `RESOURCE_IMAGE`, `UI_BLUR`, `UI_FOCUS`, `CLS`,
  `SLOW_CLICK`, and `MULTI_CLICK`.
- **2xx network requests are skipped.** Only failures are narrated. Kind counts
  still include them, so `network 58 (2 failed)` means 58 requests of which 2
  are rendered.
- **Web replays prefer `NAVIGATION_SPAN` over `NAVIGATION`.** Upstream drops the
  navigation breadcrumb for web and keeps it only for mobile, where the span is
  unavailable.
- Dead vs. rage click classification is behavioral, not a tag:
  `ui.slowClickDetected` with `payload.data.endReason === "timeout"`, a
  `payload.data.node.tagName` of `a`, `button`, or `input`, and
  `timeAfterClickMs >= 7000` is a dead click; `clickCount >= 5` promotes it to a
  rage click. Anything else is a plain slow click. Upstream also accepts the
  lowercase spellings `timeafterclickms` and `clickcount`.
- **Timestamp units vary by event type.** `get_timestamp_unit()` returns `"s"`
  for spans, web vitals, blur, and focus; `"ms"` for clicks, console, and
  navigation. `getEventTimestampMillis` currently guesses from magnitude
  (`value > 1e12`). That guess holds for present-day epochs by coincidence, not
  by rule.

## Design

### Tool surface

Add one catalog-only tool. Keep the top-level surface unchanged.

```text
get_replay_activity
```

Existing tools change behavior, not identity:

- `get_replay_details` returns a map plus a suggested next call.
- `get_sentry_resource` continues to route replay URLs to `get_replay_details`.
- `search_events` with `dataset="replays"` continues to list replays.

Deliberate deviation from handle-based designs: MCP runs over stateless HTTP and
stdio. An `open`/`close` handle pair would require KV storage, TTLs, and
lifecycle handling to buy nothing that `replayId` plus a window does not already
provide. There is no `close` tool; usage telemetry belongs on existing spans
(grain requested, window width, result counts).

### `get_replay_details` — the map

Replace the prose activity sample with session shape:

```text
# Replay 7e07485f… in **my-org**

## Summary
… unchanged fields …

## Map
- **Signals**: 1,182 across 0.0s–353.2s, 4 pages
- **Flow**: /login ▸ /cart ▸ /checkout ▸ /checkout/confirm
- **Kinds**: navigation 18 · click 36 (2 rage, 1 dead) · network 58 (2 failed) · console 4 (2 error)
- **Truncated**: no

## Chapters
… present only when a Seer summary already exists …

## Related
… unchanged …

## Next
Error CLOUDFLARE-MCP-41 occurred at T+311.8s:
get_replay_activity(organizationSlug='my-org', replayId='7e07485f…', startMs=306000, endMs=316000, grain='detail')
```

The suggested window comes from
`GET /organizations/{org}/replays-events-meta/`, which resolves the replay's
`error_ids` in one batched call (`query=id:[a,b]`) and returns `id`, `issue`,
`issue.id`, `title`, and a millisecond-precision ISO `timestamp`. Note that the
endpoint deletes `timestamp_ms` from its own output and folds that precision
into `timestamp`.

Because it returns issue identity alongside the timestamp, this call also
replaces the per-error `listIssues` lookups that populate the Related section —
one request instead of up to three.

The endpoint is `ApiPublishStatus.PRIVATE` today, with the intent to make it
public. Until then, treat the response as untrusted: parse defensively, and omit
the suggested window rather than failing the call.

### `get_replay_activity` — the zoom

```typescript
inputSchema: {
  organizationSlug: ParamOrganizationSlug.optional(),
  replayId: ParamReplayId.optional(),
  replayUrl: ParamReplayUrl.optional(),
  regionUrl: ParamRegionUrl.nullable().optional(),
  startMs: z.number().min(0).optional(),
  endMs: z.number().min(0).optional(),
  grain: z.enum(["digest", "standard", "detail"]).default("standard"),
  kinds: z.array(z.enum([
    "navigation", "click", "dead-click", "rage-click", "slow-click",
    "network", "console", "hydration-error", "feedback", "web-vital",
    "tap", "scroll", "swipe", "app-lifecycle", "device",
  ])).optional(),
  limit: z.number().min(1).max(200).default(50),
  cursor: z.string().optional(),
}
```

Semantics:

- Omitting `startMs`/`endMs` selects the whole session. Offsets are measured
  from the replay's `started_at`, not from the first recorded event.
- Omitting `kinds` includes every kind. Supplying it is an allow-list.
- `grain` controls rendering only:
  - `digest` — one rollup line per kind: `network ×58 (2 failed)`
  - `standard` — one line per signal, repeats merged with `×N`
  - `detail` — one line per signal plus available payload (method, status,
    duration, stack frames, selector attributes)
- Redaction is labeled, never inferred. `networkCaptureBodies` is opt-in, so
  bodies are frequently absent; absent payload renders as
  `body: <not captured>`. Values equal to Relay's substitution marker
  `[Filtered]` render as `<redacted>`. Client-side SDK masking leaves no
  marker and is therefore not detectable — such values render as delivered
  rather than being claimed as redacted.
- Truncation is always stated, with the `cursor` needed to continue. Sentry
  paginates segments rather than signals, so that `cursor` is synthetic: it
  encodes the window, the `kinds` allow-list, and the offset, and each page
  re-reads the recording.

Gating matches `get_replay_details`: `skills: ["inspect"]`,
`requiredCapabilities: ["replays"]`, scopes `org:read`, `project:read`,
`event:read`.

### Seer summary integration

`get_replay_details` may call the summarize endpoint for chapters. It is
`ApiPublishStatus.EXPERIMENTAL` and triple-gated on the `session-replay`
feature, the `replay-ai-summaries` feature, and Seer access, returning 403
otherwise.

Requirements:

- Treat it as strictly additive. A 403, a timeout, or a pending task must not
  degrade the map.
- **Read it once.** `get_replay_details` issues a single `GET` and renders
  chapters only if that response is already `completed`. It does not `POST` to
  start a task, and it does not retry or wait for a running one. Starting would
  spend a Seer LLM run per call for a section that would not be ready anyway;
  retrying would put unbounded latency on the primary path.
- Because the read is one-shot, chapters appear only for replays already
  summarized in the Sentry UI.
- The Seer response body is defined in `getsentry/seer` at
  `src/seer/automation/summarize/replays.py`:

  ```text
  {
    data: {time_ranges: [{period_start, period_end, period_title}], summary} | null,
    num_segments: int | null,
    created_at: datetime | null,
    status: "not_started" | "processing" | "completed" | "error",
  }
  ```

  `period_start` and `period_end` are float UNIX timestamps in **milliseconds**,
  so chapters carry windows usable for zoom, not just prose. Parse defensively
  anyway — the endpoint is `EXPERIMENTAL` — and omit the section on any status
  other than `completed`.
- Note the cold-start behavior: Seer's `/start` route returns an empty body and
  enqueues a background task, so a replay nobody has summarized in the UI
  returns `processing` on the first poll. Chapters render only for
  already-summarized replays unless the tool starts a task and accepts the LLM
  cost on every call.

## Fixes Outside the Tool Surface

These are correctness bugs in shipped code, independent of the new tool:

- Classify replay events by `payload.category`/`op`; port the noise filter and
  the dead/rage click rules.
- Replace the magnitude-based timestamp heuristic with per-type units.
- Follow the `Link` header's `cursor` on the segments index; drop the no-op
  `download=true`. This needs the raw-response request path, since
  `requestJSON` does not expose response headers. Read at most 150 segments or
  10MB of raw segment JSON, whichever comes first, and say which bound stopped
  the read. 150 matches the clamp Sentry's own summarize endpoint applies; the
  byte ceiling is the real guard, since segment sizes vary by orders of
  magnitude, parsed rrweb objects expand well beyond their JSON size, and
  `mcp-cloudflare` runs under a 128MB Workers limit. Both are provisional and
  should be measured against real replays during QA.
- Rebuild `replay-recording-segments.json` from real SDK shapes, re-baseline
  inline snapshots, and add a replay eval.
- Report every truncation. Today `MAX_ACTIVITY_EVENTS`, `MAX_RELATED_ERRORS`,
  and `MAX_RELATED_TRACES` stop silently; only the issue-details replay list
  prints an "and N more" line.
- Reconcile replay sorting against Sentry's actual sort configuration. The
  authority is `sort_config` in
  `sentry/replays/usecases/query/configs/aggregate_sort.py`; both the scalar and
  aggregated query paths order by it, and `_get_sort_column` raises a
  `ParseError` for anything absent. `REPLAY_SORT_FIELDS` in
  `packages/mcp-core/src/tools/support/search-events/replays.ts` is missing only
  `count_screens` and the aliases `browser`, `os`, and `os_name`.
  `count_traces`, `count_segments`, and `viewed_by_me` are **not** sortable and
  must not be added. `device.model` is already correct; the mismatch is that
  discovery advertises `device.model_id`, which is filterable but not sortable.
  The real defect is on the discovery side: `REPLAY_FIELDS` in
  `packages/mcp-core/src/internal/agents/tools/dataset-fields.ts` presents
  filterable fields as if they were sortable, so an agent picks a sort from
  discovery output and gets a `UserInputError`.
- Gate the `dataset="replays"` path in `search_events` on the `replays`
  capability, so replay search and replay details agree about availability.
  A tool-level `requiredCapabilities` will not do: `search_events` serves six
  datasets, and per `tools/catalog-runtime/availability.ts` the check only
  applies when a `projectSlug` constraint is set. This needs a runtime rejection
  in the handler plus removal of `replays` from the advertised dataset options.
- Distinguish rate limiting from absence in `listReplayIdsForIssue`. The
  `replay-count` endpoint enforces 20 req/s per IP, per user, **and per
  organization**. `get_issue_details` calls it on every lookup, and the current
  `.catch(() => undefined)` makes throttling indistinguishable from "no
  replays" — so parallel issue triage silently loses the Session Replay
  section.

## Examples

Orientation, then a targeted read:

```text
get_sentry_resource(url='https://my-org.sentry.io/explore/replays/7e07485f…/')
→ map: 1,182 signals, 4 pages, 2 failed network, 2 rage clicks
       error at T+311.8s → suggested window

get_replay_activity(replayId='7e07485f…', startMs=306000, endMs=316000, grain='detail')
→ T+311.8s  click    button#complete-order "Complete order"
  T+312.0s  network  POST /api/checkout → 500 (1240ms)
              body: <not captured>
  T+312.1s  console  error TypeError: Cannot read 'id' of undefined
              at submitOrder (checkout.tsx:214)
  T+312.3s  click    rage ×5 on button#complete-order (7000ms, timeout)
```

Cheap shape check on a long session:

```text
get_replay_activity(replayId='7e07485f…', grain='digest', kinds=['network','console'])
→ network ×58 (2 failed) · console ×4 (2 error)
```

## Implementation

1. Port the event taxonomy and log-message semantics into a shared internal
   module; unit-test against realistically shaped fixtures.
2. Fix segment pagination and the timestamp units in the API client.
3. Rebuild replay fixtures; re-baseline snapshots.
4. Restructure `get_replay_details` into map form with a suggested next call
   derived from error timestamps resolved through `replays-events-meta`.
5. Add `get_replay_activity` as a catalog-only tool.
6. Wire the Seer summary as an optional chapters section, read once.
7. Apply the sort-field, capability-gating, and rate-limit fixes.
8. Add a replay eval, then run
   `pnpm run --filter @sentry/mcp-core generate-definitions`.

## Testing

- Unit tests per event type using SDK-shaped events, including
  seconds-versus-milliseconds timestamps and the dead/rage click boundaries
  (`timeAfterClickMs` at 6999 vs 7000, `clickCount` at 4 vs 5).
- Snapshot tests for each grain and for a windowed slice.
- Degradation tests: summarize 403, summarize timeout, segment fetch 404,
  archived replay, replay with zero segments, and a replay exceeding one page of
  segments.
- Redaction tests asserting `<not captured>` and `<redacted>` rendering.
- A replay eval covering map-then-zoom navigation.
- `pnpm run tsc && pnpm run lint && pnpm run test` must pass, plus
  `pnpm run measure-tokens` to confirm tool-definition overhead.

## Migration

`get_replay_details` output changes shape; its inputs and name do not. Callers
passing replay URLs through `get_sentry_resource` are unaffected. Existing
inline snapshots must be re-baselined as part of the taxonomy fix, not
separately. Tool count rises by one, well inside the 20-tool target.

## Out of Scope

Web visual snapshots. Rendering a DOM snapshot requires running rrweb playback
in a browser, which this server has no place to host. The image plumbing already
exists (`get_snapshot_image`, `createImagePreview` in
`packages/mcp-core/src/internal/blob-utils.ts`), so this is a hosting gap, not a
protocol one.

Mobile replay video is tractable — replays are captured as video and
`/projects/{org}/{project}/replays/{replay_id}/videos/{segment_id}/` exists —
but it is deferred rather than half-built alongside the web path.

## Future Work

- Friction analysis via `GET /organizations/{org}/replay-selectors/`, which
  returns `count_dead_clicks`, `count_rage_clicks`, `dom_element`, and
  `element.component_name` per selector. Component names come from Sentry
  directly, with no separate corpus to author or upload. Likely belongs on the
  `search_events` replay path rather than a new tool.
- Per-replay click detail via `/replays/{replay_id}/clicks/` (node IDs and click
  timestamps only).
- `viewed-by` for review provenance. It returns an 18-key user serializer
  including `experiments`, `has2fa`, and `isSuperuser`; trim to `id`, `name`,
  and `email` before surfacing.
- Mobile replay video frames.

## Constraints and Unverified Claims

- The Seer summary response body is verified against `getsentry/seer` (see the
  Seer section above), but the endpoint is `EXPERIMENTAL` on both sides; parse
  defensively regardless.
- `replay_type` and `ota_updates` appear in the replay response but are **absent
  from `VALID_FIELD_SET`**. Requesting them returns 400. Any `field` allow-list
  must be explicit rather than derived from response keys.
- `data_source` on `replay-count` drifts between docs and runtime: docs declare
  it required with `events`/`search_issues`/`spans`; the runtime validator
  defaults to `discover` and also accepts `transactions`. The values currently
  sent by `getReplayDataSource` (`discover`, `search_issues`) are valid against
  the runtime validator.
- Replay retention is documented as 90 days paid and 30 days free. Only a flat
  90-day query window is visible in source; the per-plan split is a product-docs
  claim. Hedge in user-facing copy or verify against a free-tier org.

## References

- Implementation: `packages/mcp-core/src/tools/catalog/get-replay-details.ts`
- Replay search: `packages/mcp-core/src/tools/support/search-events/replays.ts`
- API client: `packages/mcp-core/src/api-client/client.ts`
- Schemas: `packages/mcp-core/src/api-client/schema.ts`
- Issue-details integration: `packages/mcp-core/src/internal/formatting.ts`
- Field discovery: `packages/mcp-core/src/internal/agents/tools/dataset-fields.ts`
- Fixtures: `packages/mcp-server-mocks/src/fixtures/replay-recording-segments.json`
- Upstream taxonomy: `getsentry/sentry` at
  `src/sentry/replays/usecases/ingest/event_parser.py` and
  `src/sentry/replays/usecases/summarize.py`
- Upstream summary endpoint: `getsentry/sentry` at
  `src/sentry/replays/endpoints/project_replay_summary.py`
- Upstream summary response model: `getsentry/seer` at
  `src/seer/automation/summarize/replays.py`
- Upstream error-event lookup: `getsentry/sentry` at
  `src/sentry/replays/endpoints/organization_replay_events_meta.py`
- Upstream replay sort configuration: `getsentry/sentry` at
  `src/sentry/replays/usecases/query/configs/aggregate_sort.py`
- [Replay recording event spec](https://develop.sentry.dev/sdk/data-model/event-payloads/replay-recording)
- [Sentry Replays API](https://docs.sentry.io/api/replays/)
- Tool authoring: [Adding Tools](../contributing/adding-tools.md), and
  "Tool Output Policy" in [Tool Responses](../contributing/tool-responses.md)
