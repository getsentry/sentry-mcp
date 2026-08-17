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

- [x] 2.1 Re-verify `which()`, `as_log_message()`, and `get_timestamp_unit()` against `getsentry/sentry` before porting. Two recent upstream fixes are folded in: missing `method`/`statusCode` on requests that never got a response (#120859), and PII-scrubbed values arriving where a number is expected (#121765).
- [x] 2.2 Add a shared internal module exposing replay event classification, per-type timestamp resolution, and signal rendering (`packages/mcp-core/src/internal/replay-events.ts`).
- [x] 2.3 Port the event-type taxonomy and the noise exclusion list, including skipping 2xx network requests from rendering while keeping them in kind counts, and preferring `NAVIGATION_SPAN` over `NAVIGATION` for web replays.
- [x] 2.4 Implement behavioral dead, rage, and slow click classification, reading `payload.data.node.tagName` and accepting the lowercase `timeafterclickms`/`clickcount` spellings.
- [x] 2.5 Implement `digest`, `standard`, and `detail` rendering, labeling absent payload `<not captured>` and values equal to `[Filtered]` as `<redacted>`.
- [x] 2.6 Unit-test each event type, both timestamp units, and the dead/rage boundaries at `timeAfterClickMs` 6999 vs 7000 and `clickCount` 4 vs 5.
- [x] 2.7 Resolve signal offsets from the replay's `started_at` rather than the first recorded event.

## 3. API Client

- [ ] 3.1 Re-verify the recording segments index contract against `getsentry/sentry`.
- [ ] 3.2 Follow the `Link` header's `cursor` in `getReplayRecordingSegments` and remove the non-existent `download=true` parameter. Note `per_page` is a no-op (default and maximum are both 100), and that reading the header requires the raw-response request path rather than `requestJSON`.
- [ ] 3.3 Page through segments up to 150 segments or 10MB of raw segment JSON, whichever is hit first, and report which bound stopped the read.
- [ ] 3.4 Add a single-read replay summary method for the experimental summarize endpoint, parsing the known Seer response shape (`data.time_ranges[]`, `status`) defensively. No start method and no retry loop: one `GET`, then move on.
- [ ] 3.5 Add an explicit `field` allow-list to `searchReplays`, drawn from `VALID_FIELD_SET` in `sentry/replays/validators.py`. Use upstream's coarse names (`browser`, `user`, `device`, `sdk`, `releases`, `trace_ids`) and exclude `replay_type` and `ota_updates`, which return 400.
- [ ] 3.6 Add a `getReplayErrorEvents` method wrapping `GET /organizations/{org}/replays-events-meta/` with a batched `query=id:[...]`, returning `id`, `issue`, `issue.id`, `title`, and `timestamp`. Parse `timestamp` as a millisecond-precision ISO string; the endpoint deletes `timestamp_ms` from its own output.

## 4. Replay Details as a Map

- [ ] 4.1 Replace the activity sample with signal counts, time span, page flow, and per-kind breakdown including error and rage or dead click counts.
- [ ] 4.2 Derive a suggested `get_replay_activity` window from error timestamps resolved through `getReplayErrorEvents`, degrading to no suggested window if the endpoint fails or returns no usable timestamp.
- [ ] 4.3 Replace the per-error `listIssues` lookups in the Related section with the same batched `getReplayErrorEvents` call, which already returns issue identity.
- [ ] 4.4 Fall back to a whole-session digest suggestion when no error timestamp resolves.
- [ ] 4.5 Report truncation for related issues and traces.
- [ ] 4.6 Wire the summary chapters section as a single-read enhancement, rendering only on `status: completed` and degrading silently on 403, error status, `processing`, `not_started`, timeout, and parse failure. Assert in tests that exactly one request is issued and no start request is sent.
- [ ] 4.7 Preserve archived-replay and missing-segment behavior.

## 5. Replay Activity Tool

- [ ] 5.1 Add `get_replay_activity` as a catalog-only `inspect` tool with `requiredCapabilities: ["replays"]` and replay read scopes.
- [ ] 5.2 Implement `startMs`/`endMs` windowing, defaulting to the whole session.
- [ ] 5.3 Implement `grain` and the optional `kinds` allow-list.
- [ ] 5.4 Implement `limit`/`cursor` paging with explicit truncation reporting, encoding the window, `kinds`, and offset in the synthetic cursor so continuation is stable.
- [ ] 5.5 Accept `replayUrl` as well as `organizationSlug` plus `replayId`, reusing the existing parameter resolution and constraint checks.
- [ ] 5.6 Register in the catalog and confirm it is not added to the direct top-level surface.
- [ ] 5.7 Record telemetry on the existing span: grain requested, window width, and result counts.

## 6. Adjacent Correctness Fixes

- [ ] 6.1 Add the sorts Sentry supports but `REPLAY_SORT_FIELDS` omits: `count_screens` and the aliases `browser`, `os`, `os_name`. Do not add `count_traces`, `count_segments`, or `viewed_by_me`, which are absent from `sort_config` and would be rejected.
- [ ] 6.2 Stop advertising filterable-but-unsortable replay fields as sort options in `dataset-fields.ts`, so discovery output cannot produce an invalid sort.
- [ ] 6.3 Reject `dataset="replays"` in the `search_events` handler when the constrained project lacks the `replays` capability, and drop `replays` from the advertised dataset options in that case.
- [ ] 6.4 Distinguish rate-limit and error responses from absence in `listReplayIdsForIssue`, and report unavailability in the issue Session Replay section.

## 7. Tests

- [ ] 7.1 Re-baseline `get-replay-details.test.ts` snapshots against the rebuilt fixtures.
- [ ] 7.2 Add `get-replay-activity.test.ts` covering windowing, each grain, kind filtering, paging, and constraint injection.
- [ ] 7.3 Add degradation tests: summary 403, summary `processing`, summary timeout, summary unparseable, segment fetch 404, archived replay, zero segments, multi-page segments, and the segment budget being hit.
- [ ] 7.4 Add redaction tests asserting `<not captured>` and `[Filtered]`-driven `<redacted>` rendering.
- [ ] 7.5 Add search-events tests for the replay capability gate, the dataset options omitting `replays`, and the reconciled sort list.
- [ ] 7.6 Add a `get_issue_details` test asserting rate-limited replay lookup is reported as unavailable, not as no replays.
- [ ] 7.7 Add a replay eval covering map-then-zoom navigation.
- [ ] 7.8 Update registry, tool count, skill gating, and generated-definition tests.
- [ ] 7.9 Add suggested-window tests: a resolved error timestamp produces a bracketing window, and a failing or unauthorized `replays-events-meta` lookup degrades to the whole-session suggestion with the map intact.

## 8. Documentation and Generated Definitions

- [ ] 8.1 Update `docs/specs/replay-review.md` if the implemented contract diverges from the spec.
- [ ] 8.2 Update any docs describing replay tool output.
- [ ] 8.3 Run `pnpm run --filter @sentry/mcp-core generate-definitions`.

## 9. Verification

- [ ] 9.1 Run targeted replay tool tests and catalog availability tests.
- [ ] 9.2 Run `pnpm run tsc`.
- [ ] 9.3 Run `pnpm run lint`.
- [ ] 9.4 Run `pnpm run test`.
- [ ] 9.5 Run `pnpm run measure-tokens` and confirm the added tool definition stays within budget.
- [ ] 9.6 QA against a real organization with the `mcp-qa` skill, since mocks cannot prove the SDK-shape fix. Confirm on a long real replay that the 150-segment and 10MB bounds hold under the Workers memory ceiling, and adjust them if not.
