/**
 * Guards the replay sort allow-list against Sentry's own sort configuration.
 *
 * The failure mode this prevents is asymmetric and easy to miss: a sort we
 * advertise but Sentry rejects surfaces as a `UserInputError` at query time,
 * and a sort Sentry supports but we omit is simply unreachable. Both are
 * invisible until someone tries the exact field.
 */
import { describe, expect, it } from "vitest";
import { REPLAY_SORT_FIELDS, isValidReplaySort } from "./replays.js";

/**
 * `sort_config` from
 * `sentry/replays/usecases/query/configs/aggregate_sort.py`, including the
 * four aliases assigned below the literal.
 */
const UPSTREAM_SORT_CONFIG = [
  "activity",
  "browser.name",
  "browser.version",
  "count_dead_clicks",
  "count_errors",
  "count_warnings",
  "count_infos",
  "count_rage_clicks",
  "count_urls",
  "device.brand",
  "device.family",
  "device.model",
  "device.name",
  "dist",
  "duration",
  "finished_at",
  "os.name",
  "os.version",
  "platform",
  "project_id",
  "started_at",
  "sdk.name",
  "user.email",
  "user.id",
  "user.username",
  // Aliases.
  "browser",
  "os",
  "os_name",
  "count_screens",
];

describe("replay sort fields", () => {
  it("matches Sentry's sort configuration exactly", () => {
    expect([...REPLAY_SORT_FIELDS].sort()).toEqual(
      [...UPSTREAM_SORT_CONFIG].sort(),
    );
  });

  it("accepts the sorts that were previously missing", () => {
    // `_get_sort_column` raises a ParseError for anything absent from
    // sort_config, so these were reachable in Sentry but rejected by us.
    for (const field of ["count_screens", "browser", "os", "os_name"]) {
      expect(isValidReplaySort(field)).toBe(true);
      expect(isValidReplaySort(`-${field}`)).toBe(true);
    }
  });

  it("rejects fields that are searchable but not sortable", () => {
    // Present in replay search and in field discovery, but absent from
    // sort_config — Sentry would reject a sort on any of them.
    for (const field of [
      "count_traces",
      "count_segments",
      "viewed_by_me",
      "device.model_id",
      "replay_type",
      "urls",
    ]) {
      expect(isValidReplaySort(field)).toBe(false);
      expect(isValidReplaySort(`-${field}`)).toBe(false);
    }
  });

  it("accepts both ascending and descending forms", () => {
    expect(isValidReplaySort("started_at")).toBe(true);
    expect(isValidReplaySort("-started_at")).toBe(true);
    expect(isValidReplaySort("--started_at")).toBe(false);
  });
});
