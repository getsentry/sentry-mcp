## Why

Replay retrieval returns a single fixed-grain summary capped at six activity
events, and the classifier that builds it keys on an event shape the Sentry SDK
never emits. Real user actions arrive as rrweb custom events with
`data.tag === "breadcrumb"`, where meaning lives in `payload.category`, so every
click, console error, and rage click renders under the literal label
`breadcrumb` with its real content demoted into a details blob.

Running the current handler against SDK-shaped segments produces six lines, of
which three are session-boot noise (`options`, which leaks sample rates; a
`<meta>` href; a vendor script fetch). A `ui.slowClickDetected` rage click was
dropped by the cap at only 11 input events; real sessions contain thousands. The
existing fixture uses `tag: "ui.click"`, so snapshots look correct while real
output degrades, and no replay eval exists.

Agents cannot narrow to a time window, cannot trade detail for breadth, and
cannot distinguish truncation from absence.

## What Changes

- Port Sentry's own replay event taxonomy so classification matches what Seer
  sees: classify by `payload.category` and span `op`, drop known noise types,
  skip 2xx network requests, and apply the behavioral dead/rage click rules.
- Replace the magnitude-based timestamp heuristic with per-event-type units.
- Restructure `get_replay_details` from a prose sample into a map: signal
  counts, page flow, kind breakdown with error markers, and a suggested
  follow-up call windowed on the replay's own error timestamps, resolved in one
  batched `replays-events-meta` call that also replaces the per-error issue
  lookups behind the Related section.
- Add `get_replay_activity` as a catalog-only tool: a time window (`startMs`,
  `endMs`), a grain (`digest`, `standard`, `detail`), an optional `kinds`
  allow-list, and `limit`/`cursor` paging.
- Surface Sentry's experimental replay summary endpoint as an optional
  `## Chapters` section, read once per call — never started, never retried —
  strictly additive and degrading silently.
- Fix shipped API-client bugs: follow the `Link` header's `cursor` on the
  recording segments index and drop the `download=true` parameter, which does
  not exist on that endpoint.
- Report every truncation instead of stopping silently.
- Reconcile replay sorting against Sentry's `sort_config` — adding the sorts it
  supports and no longer advertising filterable-but-unsortable fields as sort
  options — gate the `dataset="replays"` search path on the `replays`
  capability, and stop conflating `replay-count` rate limiting with "no
  replays".
- Rebuild replay fixtures from real SDK shapes and add a replay eval.

No server-side session state is introduced: `replayId` plus a window is the
navigation handle, so there is no open/close handle lifecycle.

## Capabilities

### New Capabilities

- `replay-review`: Defines map-then-zoom replay retrieval, replay event
  classification, and replay truncation reporting through MCP tools.

### Modified Capabilities

None.

## Impact

- `packages/mcp-core/src/tools/catalog/get-replay-details.ts`
- New catalog tool `packages/mcp-core/src/tools/catalog/get-replay-activity.ts`
- New shared module for replay event classification and rendering under
  `packages/mcp-core/src/internal/`
- `packages/mcp-core/src/tools/catalog/index.ts`
- `packages/mcp-core/src/tools/catalog/search-events.ts`
- `packages/mcp-core/src/tools/support/search-events/replays.ts`
- `packages/mcp-core/src/tools/catalog/get-issue-details.ts`
- `packages/mcp-core/src/api-client/client.ts`
- `packages/mcp-core/src/api-client/schema.ts`
- `packages/mcp-core/src/internal/agents/tools/dataset-fields.ts`
- `packages/mcp-server-mocks/src/fixtures/replay-recording-segments.json`
- `packages/mcp-server-mocks/src/index.ts`
- Replay tool tests, snapshots, and a new replay eval
- Generated definitions from
  `pnpm run --filter @sentry/mcp-core generate-definitions`
- `docs/specs/replay-review.md`
