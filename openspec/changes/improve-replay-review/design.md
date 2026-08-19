## Context

`get_replay_details` is a catalog-only `inspect` tool gated on the `replays`
project capability. It fetches replay metadata, downloads recording segments,
and renders a fixed six-event activity list. `search_events` with
`dataset="replays"` lists replays, and `get_issue_details` surfaces related
replay IDs through `listReplayIdsForIssue`.

Endpoint and payload validation against `getsentry/sentry@master` and the SDK
types vendored in `node_modules/@sentry-internal/replay`:

- `src/sentry/replays/usecases/ingest/event_parser.py` defines a 32-member
  `EventType` enum and a `which()` classifier keyed on `payload.category` for
  `tag: "breadcrumb"` events and on `op` for `tag: "performanceSpan"` events.
- `src/sentry/replays/usecases/summarize.py` converts each type into
  agent-facing prose through `as_log_message`, returning `None` for noise types
  and skipping 2xx network requests.
- `get_timestamp_unit()` returns `"s"` for spans, web vitals, blur, and focus,
  and `"ms"` for clicks, console, and navigation. The outer `timestamp` unit is
  therefore a function of event type, not magnitude.
- `src/sentry/replays/endpoints/project_replay_summary.py` exposes
  `POST`/`GET /projects/{org}/{project}/replays/{replay_id}/summarize/` with
  `ApiPublishStatus.EXPERIMENTAL`, gated on the `session-replay` feature, the
  `replay-ai-summaries` feature, and Seer access. It clamps `num_segments` to
  150 and proxies to Seer, returning Seer's JSON verbatim.
- The recording segments index takes only `cursor` and `per_page` and always
  downloads bodies; it has no `download` parameter. The single-segment endpoint
  does, and its check is presence-based. `per_page` cannot raise the page size:
  its default and maximum are both 100, so `cursor` is the only way past the
  first 100 segments.
- Seer's `/v1/automation/summarize/replay/breadcrumbs/start` returns an empty
  body and enqueues a background task, so a first poll on a replay nobody has
  summarized returns `processing`.
- `src/sentry/replays/endpoints/organization_replay_count.py` enforces
  20 req/s per IP, per user, and per organization.
- `GET /organizations/{org}/replays-events-meta/` resolves a batch of replay
  error event IDs in one call via `query=id:[a,b]`, returning `id`, `issue`,
  `issue.id`, `title`, `level`, `error.type`, `project.name`, and `timestamp`.
  It is `ApiPublishStatus.PRIVATE`, returns 404 without the `session-replay`
  feature and 403 without replay permission. Note the endpoint deletes
  `timestamp_ms` from its output and rewrites `timestamp` as a
  millisecond-precision ISO 8601 string, so the millisecond resolution the
  suggested window needs arrives in `timestamp`, not in a separate field.

## Goals / Non-Goals

**Goals:**

- Make replay output reflect what actually happened in a session, using
  Sentry's own classification so MCP and Seer agree.
- Let agents choose a time window and a level of detail.
- Make truncation visible everywhere it occurs.
- Give agents a computed starting window derived from known error timestamps.
- Keep the direct top-level tool surface unchanged.

**Non-Goals:**

- Web visual snapshots. Rendering a DOM snapshot requires rrweb playback in a
  browser, which this server has no place to host.
- Mobile replay video frames.
- Server-side session handles, open/close lifecycle, or usage-feedback tools.
- Changing Sentry's upstream API semantics or depending on unreleased
  endpoints as a hard requirement.

## Decisions

### Port the upstream taxonomy instead of inventing one

Classification and phrasing follow `event_parser.which()` and
`summarize.as_log_message()`. Dead versus rage clicks are behavioral, not
tagged: `ui.slowClickDetected` with `payload.data.endReason === "timeout"`, a
`payload.data.node.tagName` of `a`, `button`, or `input`, and
`timeAfterClickMs >= 7000` is a dead click, promoted to rage at
`clickCount >= 5`; anything else is a plain slow click. Upstream also accepts
the lowercase spellings `timeafterclickms` and `clickcount`, so the port reads
both.

This inherits Sentry's noise filtering for free and keeps MCP output aligned
with what Sentry's own summarizer consumes. The alternative — a bespoke
classifier — was rejected because it would drift from upstream and reproduce
the current mismatch in a new form.

The port lives in a shared internal module so `get_replay_details` and
`get_replay_activity` cannot diverge.

### Split map from zoom rather than raising the cap

`get_replay_details` returns session shape; `get_replay_activity` returns
signals for a window. Raising `MAX_ACTIVITY_EVENTS` was rejected: any fixed cap
either truncates long sessions or floods short ones, and neither tells the
agent where to look.

### `replayId` plus a window is the handle

No `client_id`, no open/close pair. MCP runs over stateless HTTP and stdio, so
handles would require KV storage, TTLs, and lifecycle handling to buy nothing
that `replayId` plus `startMs`/`endMs` does not already provide. Usage telemetry
goes on existing spans (grain requested, window width, result counts).

Parameters are camelCase (`startMs`, `endMs`) to match every other tool in the
catalog.

Statelessness has a cost worth naming: Sentry paginates recording segments, not
signals, so there is no server-side signal cursor to pass through. The `cursor`
returned by `get_replay_activity` is synthetic and must encode the window, the
`kinds` allow-list, and the offset so that continuing a page yields a stable
continuation of the same query. Each page therefore re-downloads and re-parses
the recording up to the segment budget below.

### Grain controls rendering, `kinds` controls inclusion

Keeping the two orthogonal avoids the ambiguity of a single `resolution` map
where one key both filters and sets fidelity. Omitting `kinds` includes
everything; supplying it is an allow-list.

### Seer chapters are strictly additive

The summarize endpoint is experimental and triple-gated. Its response body is
defined in `getsentry/seer` at `src/seer/automation/summarize/replays.py`:

```
SummarizeReplayBreadcrumbsStateResponse {
  data: {time_ranges: [{period_start, period_end, period_title}], summary} | null
  num_segments: int | null
  created_at: datetime | null
  status: not_started | processing | completed | error
}
```

`period_start` and `period_end` are float UNIX timestamps in milliseconds.
Chapters therefore carry windows usable for zoom, not merely prose.

A 403, an error status, a timeout, a still-running task, or a parse failure
omits the section and never degrades the map. Parsing stays defensive because
the endpoint is experimental, but the field set is known rather than guessed.

The section is read with a single request and never retried; see the decision
below. Blocking a tool call on repeated polling was rejected: it converts an
optional enhancement into a latency and failure risk on the primary path.

### Error timestamps come from `replays-events-meta`

The suggested window needs millisecond-resolution error timestamps.
`replay.error_ids` are event IDs, and resolving them through `listIssues`
returns issues, which carry no event timestamp.

`GET /organizations/{org}/replays-events-meta/` resolves the whole batch in one
call and returns issue identity alongside the timestamp, so it also replaces the
per-error `listIssues` calls that populate the Related section. The alternative,
a `getEventForIssue` lookup per error, is public but costs two sequential calls
per error on the primary path.

The accepted trade-off is that the endpoint is `ApiPublishStatus.PRIVATE` and
may change without notice; the intent is to make it public. Until then, treat
its response as untrusted: parse defensively and degrade to no suggested window
rather than failing the tool call.

### The summary is read once, never started and never polled in a loop

`get_replay_details` issues exactly one `GET` against the summarize endpoint and
renders chapters only if that single response is already `completed`. Any other
status is treated as "not available right now" and the section is omitted.

No `POST`: Seer's start route enqueues a background task and returns an empty
body, so starting on every call would spend an LLM run per replay and still
return `processing` on the immediate read — paying the cost while rendering
nothing.

No retry loop either. Waiting on a background task would put unbounded latency
on the primary path in exchange for a section that is optional by construction.
One read is bounded, cheap, and never worse than omitting the section.

The consequence is that chapters appear only for replays already summarized in
the Sentry UI. That set is small today and grows with UI adoption. Revisit if
chapters prove valuable enough to justify starting tasks.

### Segment budget is 150 segments with a byte ceiling

150 matches the clamp Sentry's own summarize endpoint applies, so MCP reads no
more of a recording than Sentry's summarizer does.

Segment count is a poor proxy for memory — segments vary in size by orders of
magnitude — so a byte ceiling is the real guard, with the segment count as a
cheap upper bound. This matters because `mcp-cloudflare` runs on Workers with a
128MB ceiling and each activity page re-reads the recording.

The ceiling starts at **10MB of raw segment JSON**, measured on the downloaded
bytes before parsing. The headroom is deliberate: parsed rrweb objects expand
several times over their JSON representation, so 10MB of input can occupy
substantially more once decoded, and the budget must survive that expansion plus
the rendering pass. `MAX_PREVIEW_SOURCE_BYTES` in
`packages/mcp-core/src/internal/blob-utils.ts` is 20MB, but that bounds image
bytes that are never expanded into an object graph, so it is not a precedent
here.

Both bounds are provisional. QA should measure actual parsed-heap cost against
real replays and adjust; the byte ceiling is the number most likely to move.

### Redaction is labeled, never inferred

`networkCaptureBodies` is opt-in, so bodies are frequently absent. Absent
payload renders as `<not captured>`; silence would imply we could have retrieved
content that was never captured.

Redaction is only claimed where it is detectable. Relay substitutes the literal
`[Filtered]` for scrubbed values, so that marker renders as `<redacted>`.
Client-side SDK masking leaves no marker — a masked string is indistinguishable
from a real one — so such values render as delivered rather than being labeled.
Guessing would be worse than silence here: a wrong `<redacted>` tells an agent
that content exists behind a mask when it may simply be the recorded value.

### Distinguish rate limiting from absence

`listReplayIdsForIssue` currently swallows every failure with
`.catch(() => undefined)`. Because `replay-count` is rate limited per
organization and `get_issue_details` calls it on every lookup, parallel issue
triage can silently lose the Session Replay section. Rate-limit responses are
reported as an unavailable-signal note rather than rendered as "no replays".

## Risks / Trade-offs

- **Snapshot churn.** The taxonomy fix changes nearly every replay snapshot.
  Fixtures must be rebuilt before snapshots are re-baselined, otherwise the new
  baselines encode the same fiction they do today. This forces task ordering.
- **Fixture realism is load-bearing.** Tests currently pass against an event
  shape the SDK never emits. New fixtures must come from the documented
  recording spec and the vendored SDK types.
- **Tool count.** Adds one catalog tool. The direct surface is unchanged and the
  count stays well inside `PUBLIC_TOOL_HARD_LIMIT`.
- **Sort allow-list changes.** Widening `REPLAY_SORT_FIELDS` risks accepting a
  sort Sentry rejects. Each added field is verified against Sentry's
  `sort_config` rather than copied from `replayFields`.
- **Experimental Seer contract.** The response shape is verified against
  `getsentry/seer`, but both endpoints are experimental. Mitigated by defensive
  parsing and optional rendering; if the shape proves unstable, the section can
  be dropped without touching the map.
- **Private `replays-events-meta` dependency.** The suggested window relies on a
  `PRIVATE` endpoint that may change without notice. Mitigated by degrading to
  no suggested window rather than failing the call, and by the intent to make
  the endpoint public.
- **Chapters may rarely appear.** A single read means chapters show up only for
  replays already summarized in the UI. Accepted deliberately: the alternatives
  are spending an LLM run per call, or waiting on a background task, for a
  section that is optional by construction.

## Migration Plan

`get_replay_details` keeps its name and inputs; only its output shape changes.
Callers passing replay URLs through `get_sentry_resource` are unaffected.
Existing inline snapshots are re-baselined as part of the taxonomy change, not
as a separate step. No API-client method is removed.

## Resolved Questions

- **Do Seer chapters carry usable timestamps?** Yes. `period_start` and
  `period_end` are float UNIX milliseconds, so chapters can drive zoom windows.
  They complement rather than replace the error-derived suggested window,
  because the summary is triple-gated and frequently absent.
- **Should `get_replay_activity` accept an `errorId` shortcut?** No. It would
  duplicate whatever timestamp resolution the suggested window uses, and the
  suggested call in `get_replay_details` already covers the case.

- **Where does an error's timestamp come from?** Resolved: the
  `replays-events-meta` endpoint, accepting its private status. See the decision
  above.
- **Does `get_replay_details` start a Seer summary, or only poll?** Resolved:
  neither — one read, no start request and no retry loop. See the decision
  above.
- **What is the segment download budget?** Resolved: 150 segments or 10MB of raw
  segment JSON, whichever comes first. Both provisional. See the decision above.

## Open Questions

None blocking implementation. The three decisions above are settled. The
10MB byte ceiling and the 150-segment bound are starting values chosen from
upstream precedent and headroom reasoning rather than measurement, and QA
(task 9.6) should confirm or adjust them against real replays.
