# Replay Review Specification

> **Status: implemented.** The Motivation section below describes the behavior
> that prompted this work and is retained as the record of what was wrong; it is
> written in the present tense of that time. See "Divergences from the As-Built
> Implementation" at the end for the points where the shipped code differs from
> what this spec proposed.

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
- **Signals**: 1,182 signals across T+0.0s–T+5m 53.2s
- **Flow**: /login ▸ /cart ▸ /checkout ▸ /checkout/confirm
- **Kinds**: navigation 18 · click 36 (2 rage, 1 dead) · network 58 (2 failed) · console 4 (2 error)
- **Truncated**: no

## Chapters
… present only when a Seer summary already exists …

## Related
… unchanged …

## Next
Error CLOUDFLARE-MCP-41 occurred at T+5m 11.8s. Use the Sentry tool `get_replay_activity` to read the signals in a time window:
get_replay_activity(organizationSlug='my-org', replayId='7e07485f…', startMs=306000, endMs=316000, grain='detail')
```

Offsets render in the same `T+` form throughout, rather than mixing bare
seconds into the Map and Next lines. The page count was dropped from the
Signals line: the Flow line already lists the pages, and a count beside a time
span read as a count of something temporal.

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
  discovery output and gets a `UserInputError`. Note that discovery carries no
  sortability signal at all, so the fix is to add one rather than to correct an
  existing claim — see the divergences section.
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

Web visual snapshots. *Rendering* a DOM snapshot requires running rrweb playback
in a browser, which this server has no place to host. The image plumbing already
exists (`get_snapshot_image`, `createImagePreview` in
`packages/mcp-core/src/internal/blob-utils.ts`), so this is a hosting gap, not a
protocol one.

Note the distinction from the DOM *tree*, which is a different problem with a
different answer. Rendering needs a layout engine; reading the structure does
not, and the structure is already in the segments we download. See "DOM tree
reads" under Future Work.

Mobile replay video is tractable — replays are captured as video and
`/projects/{org}/{project}/replays/{replay_id}/videos/{segment_id}/` exists —
but it is deferred rather than half-built alongside the web path.

## Future Work

### DOM tree reads

The largest capability gap against comparable tools. Peers expose a
`review-snapshot`-style call returning a screenshot, a component tree, and
bounding boxes at a timestamp, rooted at an optional component id. Of those four
pieces, the tree and the rooting are reachable here; the image and the boxes are
not, and for the same reason.

**What the segments already contain.** A recording is rrweb events, and the ones
this spec's taxonomy ignores are exactly the ones carrying structure:

| `type` | rrweb name | Currently |
|---|---|---|
| 2 | `FullSnapshot` | Ignored — carries the complete serialized DOM |
| 3 | `IncrementalSnapshot` | Ignored except `source: 9` (canvas) |
| 5 | `Custom` | Everything this spec classifies |

Upstream's `which()` ignores types 2 and 3 too, so nothing was lost by matching
it — Seer summarizes behavior, not structure. But the data is already downloaded
and discarded.

#### The reconstruction model

A `FullSnapshot` holds `serializedNodeWithId` recursively. Node shapes differ by
`NodeType` — Document 0, DocumentType 1, Element 2, Text 3, CDATA 4, Comment 5 —
and the distinction that matters for rendering is that **element nodes have no
`textContent`**. Their text lives in child text nodes, so a button's label is a
child, not a property. Elements carry `tagName`, `attributes`, and `childNodes`;
text, CDATA, and comment nodes carry `textContent`.

State at time *T* is the last `FullSnapshot` at or before *T*, with every
intervening `IncrementalSnapshot` applied in order. Two sources mutate structure
or content:

- `source: 0` (`Mutation`) — four arrays. `adds` (`parentId`, `nextId`,
  serialized `node`), `removes` (`parentId`, `id`), `attributes` (`id` plus a
  partial map whose `null` values mean removal and whose values may be a
  `styleOMValue` rather than a string), and `texts` (`id`, `value`).
- `source: 5` (`Input`) — `id`, `text`, `isChecked`. **Input values do not
  arrive as attribute mutations.** A tree that applies only `source: 0` shows
  every field at its initial value, which is worse than showing nothing: it
  looks authoritative and is stale.

`nextId` is the ordering handle for `adds`; `previousId` exists only for
backward compatibility and should be ignored. An `add` whose `parentId` is
unknown — because it was pruned, or the snapshot was truncated — must be
dropped rather than reparented, and the drop counted toward the fidelity report
below.

#### Reconstruction is not guaranteed to be cheap

The naive read is "start at segment zero, apply everything". Whether that is
necessary depends on how often full snapshots appear, and the answer is not
fixed: rrweb re-snapshots on `checkoutEveryNms`/`checkoutEveryNth`, and Sentry's
SDK additionally treats the first event of a recording as a checkout
(`handleRecordingEmit`). So a recording may contain several `FullSnapshot`
events, and a read at *T* only needs the nearest one at or before it.

This is the single largest open question, and it decides the shape of the
feature:

- **If checkouts are frequent** — a tree read pages segments until it passes *T*,
  keeping only the most recent snapshot seen, then applies the remaining
  mutations. Cost is bounded by checkout spacing, not by session length.
- **If a recording has exactly one snapshot at segment zero** — a read at the end
  of a long session must apply every mutation in between, and cost grows with
  session length. That is the case where the memory ceiling binds and where a
  read may have to refuse rather than truncate.

QA should answer this before the interface is settled. Implementing for the
frequent-checkout case and discovering the single-snapshot case in production
means a tool that works on short replays and OOMs on the long ones that matter.

#### Fidelity must be reported, not assumed

A reconstruction can be complete, partial, or wrong, and the three are
indistinguishable from the output alone. Consistent with this spec's rule that
truncation is always stated, a tree read reports what it did:

- Which `FullSnapshot` it started from, as an offset.
- How many mutation events it applied.
- How many operations it dropped, and why (unknown `parentId`, unknown `id`,
  malformed payload).
- Whether it stopped early against a budget.

A read that dropped a meaningful fraction of its mutations is a read whose tree
should not be trusted for the element in question, and the caller cannot know
that unless told.

#### What is not reachable

Bounding boxes require layout, and rrweb records no geometry beyond the `Meta`
event's viewport width and height. A `visible` lens is the same problem:
visibility is a computed style, not a recorded fact — `display: none` on an
ancestor is knowable only by resolving the cascade, which is a browser's job.
Both belong with the screenshot in Out of Scope.

An `interactive` lens is decidable from tag and attributes alone — form
controls, buttons, links, `[role]`, `[onclick]`, `[tabindex]` — and is the
useful one regardless, since it is the set a user can act on.

#### Rooting is nearly free

rrweb node ids are stable within a recording and already reach us: every click
breadcrumb carries `payload.data.node.id` alongside the `tagName` and
`attributes` the classifier renders today. So "show me the DOM around the
element that was rage-clicked" needs no new identifier scheme — the id in the
signal is the handle, and `get_replay_activity` already surfaces those signals.

This is what makes the feature coherent rather than a curiosity: the map finds
the failure, the activity read names the element, and the tree read explains
what was around it. Each step hands the next a concrete handle.

#### Tool surface

Three options, with the tradeoff that decides it.

**A. A separate `get_replay_dom` tool.** A point-in-time structural read is a
different operation from a windowed signal list: different return shape,
different cost model, different failure modes. It is also the only option where
a read can refuse on budget grounds without complicating an existing tool's
contract.

**B. A `grain: "dom"` on `get_replay_activity`.** Reuses the tool, but `grain`
currently means "how verbose", not "what kind of thing". A `dom` grain would
change the return type rather than its verbosity, and would need `startMs`
and `endMs` collapsed to a point, which the window semantics do not express.

**C. An `include: ["tree"]` parameter on `get_replay_activity`.** Closest to the
peer design, but pushes a second, much more expensive operation behind a
parameter on a tool agents already call routinely. A caller asking for signals
should not risk a multi-megabyte reconstruction because a default changed.

**Recommendation: A.** The catalog is the right home — it costs no direct-surface
budget, which is why `get_replay_activity` landed there too. Sketch:

```typescript
get_replay_dom({
  organizationSlug, replayId, regionUrl,   // or replayUrl
  atMs: number,                            // required; no sensible default
  rootNodeId?: number,                     // from a click signal
  lens?: "interactive" | "full",           // default "interactive"
  maxDepth?: number,
  maxNodes?: number,
})
```

`atMs` is deliberately required. A tree with no timestamp would default to
either end of the session, and both defaults are wrong often enough that
guessing is worse than asking.

Expected output, rooted at a click's node id:

```text
# Replay 7e07485f… DOM at T+3m 1.3s

Reconstructed from the snapshot at T+0.4s, applying 1,847 mutations.
Dropped 3 operations (unknown parentId).

form#checkout-form
  ├─ div.address-block
  │   ├─ input#unit [value="***"]
  │   └─ input#zip [value="***"]
  └─ button#complete-order  "Complete order" [disabled]

Node ids: form#checkout-form=88, button#complete-order=96
```

#### Masking is not redaction

`maskAllText` and `maskAllInputs` default to on, so a real tree arrives with
text and input values already replaced by the SDK, client-side, with no marker.
Per this spec's redaction rule, such values render as delivered and must not be
labeled `<redacted>` — the tool cannot distinguish "masked at capture" from
"genuinely this text". Only Relay's `[Filtered]` marker supports that claim.

The practical consequence is that a tree is a **structural** artifact, not a
content one. It answers "was the button disabled", "did the error node exist
yet", "what was around the element the user rage-clicked". It does not answer
"what did the user type", and should not be built as though it might.

#### Testing

Beyond the usual unit coverage, three cases carry the risk:

- **Reconstruction correctness.** Apply a known mutation sequence to a known
  snapshot and assert the resulting tree — including that an `add` with an
  unknown `parentId` is dropped and counted, not reparented.
- **Input values come from `source: 5`.** A fixture where a field's value
  changes only via an input event must render the new value. This is the
  failure that would otherwise ship silently, since a `source: 0`-only
  implementation produces a plausible-looking stale tree.
- **Budget refusal.** A recording that cannot be reconstructed within budget
  must say so rather than return a partial tree that reads as complete.

#### Open questions for QA

- Does a `FullSnapshot` appear only at segment zero, or periodically? This
  decides whether reconstruction cost scales with session length or with
  checkout spacing — see above.
- Do real click breadcrumbs carry `payload.data.node.id` consistently, or only
  sometimes? This decides whether subtree rooting is a reliable entry point or
  best-effort.
- How large is a real `FullSnapshot` in practice? The 10MB segment budget was
  set for signal extraction; a tree read has a different profile.

### Other

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

## Divergences from the As-Built Implementation

Where the shipped code differs from what this spec proposed, and why.

### Discovery gained a sortability flag rather than losing fields

The spec framed `REPLAY_FIELDS` as advertising filterable fields "as if they
were sortable". It carried no sortability signal at all — a flat list that
invited an agent to sort by anything on it. Removing the unsortable entries
would have been wrong, since they are legitimately searchable; the fix adds a
`sortable` flag drawn from the same allow-list as `REPLAY_SORT_FIELDS`, plus a
routing-prompt line telling the agent to respect it.

The sort list also turned out to be short by exactly the four the spec named.
It is now verified against upstream's 29 keys by a test that fails in both
directions, so a sort we advertise and Sentry rejects is as visible as one
Sentry supports and we omit.

### Dataset narrowing uses a general hook, not replay-specific logic

The spec called for "removal of `replays` from the advertised dataset options"
without saying where that lives. Special-casing replays inside
`getFilteredInputSchema` would have put one tool's concern in shared
infrastructure, so `ToolConfig` gained a general `refineInputSchema(schema,
context)` hook and `search_events` supplies the replay-specific narrowing.
`requiredCapabilities` still gates whole tools; this covers the case where a
tool stays available but not all of its options apply.

### Both replay tools share extracted parameter resolution

`get_replay_activity` accepts the same `replayUrl`-or-`organizationSlug`-plus-
`replayId` shape as `get_replay_details`. Rather than reimplement it, the
resolution and the project-constraint check were extracted to
`packages/mcp-core/src/internal/tool-helpers/replay.ts`, so the two tools cannot
drift apart on which replays a constrained session may read.

### The activity cursor overrides its sibling arguments

The spec said the synthetic cursor encodes the window, `kinds`, and offset. It
did not say what happens when a caller passes a cursor *and* a conflicting
window. A cursor fully describes its own query and wins over any window or
filter passed beside it — otherwise a continuation could silently page through
different criteria than the first request. It is base64url-encoded JSON, opaque
by intent.

### The Related section lists unresolvable error ids

The spec had `replays-events-meta` replacing the per-error `listIssues` lookups
for issue identity. Related entries are still driven by `replay.error_ids`, so
an id the private endpoint cannot resolve is listed by id rather than dropped —
`error_ids` is the replay's own record that an error occurred, and omitting it
would understate the session.

### `count_dead_clicks` includes rage clicks

Not a divergence in our code, but a fixture correction worth recording: upstream
sets `click_is_dead` for both `DEAD_CLICK` and `RAGE_CLICK`, and
`count_dead_clicks` sums that column. A replay with one rage click and one dead
click therefore reports `count_dead_clicks: 2`, not 1. The Summary section
mirrors Sentry's own counts, so it inherits this; the Map's `click 4 (1 rage, 1
dead)` breakdown is computed from the recording and counts them separately.

### Two upstream fixes folded in

Beyond the spec's list, the taxonomy port includes two upstream fixes:

- #120859 — `as_log_message` indexed `payload["data"]["method"]` and
  `["statusCode"]` directly, which raises for a request that never got a
  response. Upstream now renders `no response` in place of a status; we do the
  same, and report the request rather than dropping it.
- #121765 — PII scrubbing can replace a click breadcrumb's numeric `timestamp`
  with a marker string, and `int()` raised `ValueError` on it. Our equivalent is
  `resolveTimestampMs` returning `null` for a non-finite timestamp, so one
  scrubbed click cannot take out the events around it.

### Still provisional

The 150-segment and 10MB bounds remain unmeasured against real replays. Mocks
cannot exercise them meaningfully — the fixtures are orders of magnitude smaller
than a real recording — so they stand as reasoned defaults until QA against a
real organization confirms or moves them.

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
- rrweb event, mutation, and serialized-node types:
  [`rrweb-io/rrweb` `packages/types/src/index.ts`](https://github.com/rrweb-io/rrweb/blob/master/packages/types/src/index.ts).
  Sentry pins its own copy of the `EventType` enum in
  `src/sentry/replays/testutils.py`, which is the version to match.
- [Sentry Replays API](https://docs.sentry.io/api/replays/)
- Tool authoring: [Adding Tools](../contributing/adding-tools.md), and
  "Tool Output Policy" in [Tool Responses](../contributing/tool-responses.md)
