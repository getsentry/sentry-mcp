## 1. Fixtures First

Fixtures must be realistic before any snapshot is re-baselined, otherwise new
baselines encode the same wrong event shape they do today.

- [x] 1.1 Rebuild `packages/mcp-server-mocks/src/fixtures/replay-recording-segments.json` from the documented recording spec and the `@sentry-internal/replay` frame types, using `tag: "breadcrumb"` with `payload.category` for user actions. Those types are present only transitively (`node_modules/.pnpm/@sentry-internal+replay@*/.../types/replayFrame.d.ts`), so read them for shape but do not import them — copy what is needed rather than adding a dependency on an internal package.
- [x] 1.2 Include at least one each of: `ui.click`, `console` error, `navigation` breadcrumb, `navigation.navigate` span, `resource.fetch` with a 5xx status, `resource.fetch` with a 2xx status, `ui.slowClickDetected` meeting rage thresholds, `options`, and `resource.script`.
- [x] 1.3 Add a multi-page segment fixture and MSW handlers that emit a `Link` header with a `cursor` so segment paging is exercisable.
- [x] 1.4 Add a `replayId` to `packages/mcp-server-evals/src/evals/utils/fixtures.ts`.
- [x] 1.5 Add summarize-endpoint fixtures and MSW handlers covering `completed`, `processing`, and 403. Default handler returns `completed`; `replaySummaryProcessingFixture` is exported and 403 needs no fixture, so both are applied as per-test `mswServer.use` overrides when task 4.6 lands.
- [x] 1.6 Add `replays-events-meta` fixtures and MSW handlers returning `id`, `issue`, `issue.id`, `title`, and a millisecond-precision ISO `timestamp` for the fixture replay's `error_ids`.

## 2. Event Classification Module

- [x] 2.1 Re-verify `which()`, `as_log_message()`, and `get_timestamp_unit()` against `getsentry/sentry` before porting. Two recent upstream fixes are folded in: missing `method`/`statusCode` on requests that never got a response (#120859), and PII-scrubbed values arriving where a number is expected (#121765). Verified against the commits in `getsentry/sentry`.
- [x] 2.2 Add a shared internal module exposing replay event classification, per-type timestamp resolution, and signal rendering (`packages/mcp-core/src/internal/replay-events.ts`).
- [x] 2.3 Port the event-type taxonomy and the noise exclusion list, including skipping 2xx network requests from rendering while keeping them in kind counts, and preferring `NAVIGATION_SPAN` over `NAVIGATION` for web replays.
- [x] 2.4 Implement behavioral dead, rage, and slow click classification, reading `payload.data.node.tagName` and accepting the lowercase `timeafterclickms`/`clickcount` spellings.
- [x] 2.5 Implement `digest`, `standard`, and `detail` rendering, labeling absent payload `<not captured>` and values equal to `[Filtered]` as `<redacted>`.
- [x] 2.6 Unit-test each event type, both timestamp units, and the dead/rage boundaries at `timeAfterClickMs` 6999 vs 7000 and `clickCount` 4 vs 5.
- [x] 2.7 Resolve signal offsets from the replay's `started_at` rather than the first recorded event.

## 3. API Client

- [x] 3.1 Re-verify the recording segments index contract against `getsentry/sentry`. Confirmed: `GenericOffsetPaginator` emits `0:<offset>:0` cursors, `PAGINATION_DEFAULT_PER_PAGE` and `max_per_page` are both 100, and the index has no `download` parameter.
- [x] 3.2 Follow the `Link` header's `cursor` in `getReplayRecordingSegments` and remove the non-existent `download=true` parameter. Note `per_page` is a no-op (default and maximum are both 100), and that reading the header requires the raw-response request path rather than `requestJSON`.
- [x] 3.3 Page through segments up to 150 segments or 10MB of raw segment JSON, whichever is hit first, and report which bound stopped the read. `get_replay_details` now prints the bound that stopped it; full truncation reporting lands with the map in section 4.
- [x] 3.4 Add a single-read replay summary method for the experimental summarize endpoint, parsing the known Seer response shape (`data.time_ranges[]`, `status`) defensively. No start method and no retry loop: one `GET`, then move on.
- [x] 3.5 Add an explicit `field` allow-list to `searchReplays`, drawn from `VALID_FIELD_SET` in `sentry/replays/validators.py`. Use upstream's coarse names (`browser`, `user`, `device`, `sdk`, `releases`, `trace_ids`) and exclude `replay_type` and `ota_updates`, which return 400.
- [x] 3.6 Add a `getReplayErrorEvents` method wrapping `GET /organizations/{org}/replays-events-meta/` with a batched `query=id:[...]`, returning `id`, `issue`, `issue.id`, `title`, and `timestamp`. Parse `timestamp` as a millisecond-precision ISO string; the endpoint deletes `timestamp_ms` from its own output.

## 4. Replay Details as a Map

- [x] 4.1 Replace the activity sample with signal counts, time span, page flow, and per-kind breakdown including error and rage or dead click counts.
- [x] 4.2 Derive a suggested `get_replay_activity` window from error timestamps resolved through `getReplayErrorEvents`, degrading to no suggested window if the endpoint fails or returns no usable timestamp.
- [x] 4.3 Replace the per-error `listIssues` lookups in the Related section with the same batched `getReplayErrorEvents` call, which already returns issue identity. Related entries are still driven by `replay.error_ids`, so an id the private endpoint cannot resolve is listed by id rather than dropped.
- [x] 4.4 Fall back to a whole-session digest suggestion when no error timestamp resolves.
- [x] 4.5 Report truncation for related issues and traces.
- [x] 4.6 Wire the summary chapters section as a single-read enhancement, rendering only on `status: completed` and degrading silently on 403, error status, `processing`, `not_started`, timeout, and parse failure. Assert in tests that exactly one request is issued and no start request is sent. Also covered: a non-completed status that carries stale chapter data, verified by mutation to fail without the status guard.
- [x] 4.7 Preserve archived-replay and missing-segment behavior.

## 5. Replay Activity Tool

- [x] 5.1 Add `get_replay_activity` as a catalog-only `inspect` tool with `requiredCapabilities: ["replays"]` and replay read scopes.
- [x] 5.2 Implement `startMs`/`endMs` windowing, defaulting to the whole session. Bounds are inclusive; a signal whose timestamp did not resolve is excluded from a windowed read rather than guessed into one.
- [x] 5.3 Implement `grain` and the optional `kinds` allow-list.
- [x] 5.4 Implement `limit`/`cursor` paging with explicit truncation reporting, encoding the window, `kinds`, and offset in the synthetic cursor so continuation is stable. A cursor fully describes its query and overrides any window or filter passed alongside it, verified by mutation.
- [x] 5.5 Accept `replayUrl` as well as `organizationSlug` plus `replayId`, reusing the existing parameter resolution and constraint checks. Both were extracted to `internal/tool-helpers/replay.ts` so the two replay tools cannot diverge.
- [x] 5.6 Register in the catalog and confirm it is not added to the direct top-level surface. `pnpm run measure-tokens` is unchanged at 5,598 tokens across 9 direct tools.
- [x] 5.7 Record telemetry on the existing span: grain requested, window width, and result counts.

## 6. Adjacent Correctness Fixes

- [x] 6.1 Add the sorts Sentry supports but `REPLAY_SORT_FIELDS` omits: `count_screens` and the aliases `browser`, `os`, `os_name`. Do not add `count_traces`, `count_segments`, or `viewed_by_me`, which are absent from `sort_config` and would be rejected. The list is now verified against upstream's 29 keys with a test asserting exact parity.
- [x] 6.2 Stop advertising filterable-but-unsortable replay fields as sort options in `dataset-fields.ts`, so discovery output cannot produce an invalid sort. Discovery had no sortable signal at all, so replay fields now carry a `sortable` flag derived from the same allow-list, and the agent prompt tells the router to respect it.
- [x] 6.3 Reject `dataset="replays"` in the `search_events` handler when the constrained project lacks the `replays` capability, and drop `replays` from the advertised dataset options in that case. The check runs on the resolved dataset so an agent-chosen route is rejected too; schema narrowing uses a new general `refineInputSchema` hook rather than replay-specific logic in shared infrastructure.
- [x] 6.4 Distinguish rate-limit and error responses from absence in `listReplayIdsForIssue`, and report unavailability in the issue Session Replay section. Covered for both the no-replays-found and attached-replay-only cases, verified by mutation.

## 7. Tests

- [x] 7.1 Re-baseline `get-replay-details.test.ts` snapshots against the rebuilt fixtures.
- [x] 7.2 Add `get-replay-activity.test.ts` covering windowing, each grain, kind filtering, paging, and constraint injection.
- [x] 7.3 Add degradation tests: summary 403, summary `processing`, summary timeout, summary unparseable, segment fetch 404, archived replay, zero segments, multi-page segments, and the segment budget being hit. Summary degradation covers eight responses including a connection failure and a non-JSON body; the byte budget is tripped end-to-end rather than by injecting a bound.
- [x] 7.4 Add redaction tests asserting `<not captured>` and `[Filtered]`-driven `<redacted>` rendering. Unit-level in `replay-events.test.ts`, plus end-to-end through `get_replay_activity` at detail grain, where the two labels appear on the same signal so they cannot be conflated.
- [x] 7.5 Add search-events tests for the replay capability gate, the dataset options omitting `replays`, and the reconciled sort list.
- [x] 7.6 Add a `get_issue_details` test asserting rate-limited replay lookup is reported as unavailable, not as no replays.
- [x] 7.7 Add a replay eval covering map-then-zoom navigation. `get-replay.eval.ts` runs the tools for real against the mocks, so it can only pass by reading the suggested window off the map. Scores 1.00; mutating the expected offset drops it to 0.5, confirming the offsets are load-bearing. Only the zoom is asserted — the map is reachable through either `get_sentry_resource` or the catalog, and both are correct.
- [x] 7.8 Update registry, tool count, skill gating, and generated-definition tests. Capability gating was untested for any tool; `availability.test.ts` now covers replays-present, replays-absent, unconstrained, direct-surface, and skill-gated cases, verified by mutation. Generated definitions are current and the token budget is unchanged at 5,598.
- [x] 7.9 Add suggested-window tests: a resolved error timestamp produces a bracketing window, and a failing or unauthorized `replays-events-meta` lookup degrades to the whole-session suggestion with the map intact. Landed with task 4.2.

## 8. Documentation and Generated Definitions

- [x] 8.1 Update `docs/specs/replay-review.md` if the implemented contract diverges from the spec. Added a status banner (Motivation is retained as the record of what was wrong, in its original present tense), corrected the Map example to the shipped `T+` offset format, and added a "Divergences from the As-Built Implementation" section covering the sortability flag, the `refineInputSchema` hook, shared parameter resolution, cursor precedence, unresolvable error ids, `count_dead_clicks` including rage clicks, and the two upstream fixes. The #120859/#121765 descriptions were swapped in the task notes; verified against the commits and corrected.
- [x] 8.2 Update any docs describing replay tool output. Nothing else describes it: `docs/operations/embedded-agents.md` and `docs/contributing/adding-tools.md` mention replays only in passing and both remain accurate. `proposal.md` and the delta spec are the historical record of the change and are left as written.
- [x] 8.3 Run `pnpm run --filter @sentry/mcp-core generate-definitions`. Already up to date — no regeneration needed.

## 9. Verification

- [x] 9.1 Run targeted replay tool tests and catalog availability tests. 167 passed across 9 files.
- [x] 9.2 Run `pnpm run tsc`. Clean.
- [x] 9.3 Run `pnpm run lint`. 2 warnings, both pre-existing and unrelated (`mcp-cloudflare/index.html` noDescendingSpecificity, `oauth/helpers.test.ts` noUnusedImports).
- [x] 9.4 Run `pnpm run test`. 8/8 tasks; mcp-core 1481 passed / 6 skipped. The `smoke-tests` package skips without a deployed `PREVIEW_URL`, which is expected locally and unrelated to replays.
- [x] 9.5 Run `pnpm run measure-tokens` and confirm the added tool definition stays within budget. Unchanged at 5,598 tokens across 9 direct tools — `get_replay_activity` is catalog-only, so it costs no direct-surface budget.
- [ ] 9.6 QA against a real organization with the `mcp-qa` skill, since mocks cannot prove the SDK-shape fix. Confirm on a long real replay that the 150-segment and 10MB bounds hold under the Workers memory ceiling, and adjust them if not. `get_replay_dom` is the read most exposed to those bounds, since it must page to the requested moment rather than sampling; check how often a reconstruction refuses on real sessions. Two of the three DOM observations originally filed here no longer gate anything: snapshot frequency is handled by superseding the node map wholesale, so both cases take one path. Still worth capturing: whether real click breadcrumbs populate `payload.data.node.id` consistently, which decides whether rooting is a reliable entry point or best-effort, and how large a real `FullSnapshot` is. None of these block this change.

## 10. DOM Tree Reads

Promoted from Future Work and built in this change: the map and the zoom answer
what happened, but nothing answered what the page was, which is the question a
structural failure actually poses.

- [x] 10.1 Add a streaming segment reader so a reconstruction never holds the raw recording alongside the derived state. Returning `"stop"` ends paging early and is reported as `truncatedBy: null`, since stopping by choice is not truncation. The buffering read is now a thin wrapper over it, with its existing tests untouched.
- [x] 10.2 Add `internal/replay-dom.ts`: fold `FullSnapshot` (`type: 2`) and `IncrementalSnapshot` (`type: 3`) into a flat node map. A later snapshot supersedes wholesale rather than merging, which makes checkout frequency irrelevant to correctness. Input values come from `source: 5`, not attribute mutations. Unknown-parent adds are dropped and counted, never reparented. Subtree deletion is iterative, since untrusted DOM depth should not reach the call stack.
- [x] 10.3 Render as an indented tree with `interactive` and `full` lenses and optional subtree rooting. No `visible` lens: visibility needs the cascade. Text comes from immediate text children only, since rrweb element nodes carry none.
- [x] 10.4 Report the rrweb node id at detail grain in `get_replay_activity`. It was parsed but never rendered, so nothing named the element a DOM read could root at — the handoff the design depends on did not exist.
- [x] 10.5 Add `get_replay_dom` as a catalog-only `inspect` tool with `requiredCapabilities: ["replays"]` and replay read scopes, reusing `internal/tool-helpers/replay.ts`. Required `atMs`; refusal on budget exhaustion rather than a partial tree; the recording ending early and an unparseable `started_at` are both reported rather than guessed past. Token budget unchanged at 5,598 across 9 direct tools.
- [x] 10.6 Add DOM events to the recording fixture: both pages snapshotted, plus a `source: 5`-only input change, an ignored scroll, an added error banner, and a text-plus-attribute mutation disabling the submit button after the console error.
- [x] 10.7 Test reconstruction, input-value precedence, target-time exclusion, rooting, lenses, truncation, budget refusal, and gating. Extend `availability.test.ts` to the third replay tool.
- [x] 10.8 Fix the render root. Verified against the `@sentry-internal/rrweb-snapshot` build Sentry ships: `serializeNodeWithId` assigns an id to every node including the Document, so a real snapshot roots at a `nodeType: 0` node and the renderer emitted nothing. The unit fixtures had modelled an id-less wrapper, which hid it — they now carry the real shape. Three rendering defects surfaced with them: `role` presence treated as interactivity, `isChecked` rendered for non-checkboxes, and empty-string boolean attributes rendered as `[disabled=]`. Each fix is pinned by a test that fails without it.
- [x] 10.9 Update `docs/specs/replay-review.md`: promote the DOM section from Future Work into Design, replace the proposed output with the shipped format, and record the divergences.
