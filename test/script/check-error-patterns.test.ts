/**
 * Tests for the error-pattern checker (script/check-error-patterns.ts).
 *
 * The script both runs standalone (globbing src/, printing, process.exit) and
 * exports its detection + baseline logic so it can be unit-tested against string
 * fixtures. We exercise the pure functions directly and run the whole check as a
 * subprocess against the real source tree to guard the committed baseline.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  compareToBaseline,
  countByFile,
  findAdHocTryPatterns,
  findContextErrorNewlines,
  findSilentCatches,
} from "../../script/check-error-patterns.ts";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function runCheck(args: string[] = []) {
  return spawnSync("pnpm", ["tsx", "script/check-error-patterns.ts", ...args], {
    cwd: pkgRoot,
    encoding: "utf-8",
  });
}

describe("findSilentCatches", () => {
  test("flags an empty catch", () => {
    const src = "try { f(); } catch {}";
    expect(findSilentCatches(src, "a.ts")).toHaveLength(1);
  });

  test("flags a comment-only catch", () => {
    const src = "try { f(); } catch (e) {\n  // ignore\n}";
    expect(findSilentCatches(src, "a.ts")).toHaveLength(1);
  });

  test("flags a return-only catch", () => {
    const src = "try { f(); } catch {\n  return null;\n}";
    expect(findSilentCatches(src, "a.ts")).toHaveLength(1);
  });

  test("flags a return-only .catch() handler", () => {
    const src = "p.catch((e) => {\n  return null;\n});";
    expect(findSilentCatches(src, "a.ts")).toHaveLength(1);
  });

  test("allows a catch that logs", () => {
    const src = "try { f(); } catch (e) {\n  log.debug('x', e);\n}";
    expect(findSilentCatches(src, "a.ts")).toHaveLength(0);
  });

  test("allows a catch that re-throws", () => {
    const src = "try { f(); } catch (e) {\n  throw e;\n}";
    expect(findSilentCatches(src, "a.ts")).toHaveLength(0);
  });

  test("allows a catch that forwards the error", () => {
    const src =
      "try { f(); } catch (error) {\n  return handleFetchError(error);\n}";
    expect(findSilentCatches(src, "a.ts")).toHaveLength(0);
  });
});

describe("findContextErrorNewlines", () => {
  test("flags a multi-line command argument", () => {
    const src = 'throw new ContextError("issue", "run this\\nthen that");';
    expect(findContextErrorNewlines(src, "a.ts")).toHaveLength(1);
  });

  test("allows a single-line command argument", () => {
    const src = 'throw new ContextError("issue", "sentry issue list");';
    expect(findContextErrorNewlines(src, "a.ts")).toHaveLength(0);
  });
});

describe("findAdHocTryPatterns", () => {
  test('flags a CliError with an ad-hoc "Try:" string', () => {
    const src = 'throw new CliError(\n  "nope",\n  "Try: sentry login",\n);';
    expect(findAdHocTryPatterns(src, "a.ts")).toHaveLength(1);
  });

  test("allows a CliError without a Try string", () => {
    const src = 'throw new CliError("something went wrong");';
    expect(findAdHocTryPatterns(src, "a.ts")).toHaveLength(0);
  });
});

describe("countByFile", () => {
  test("groups violations into per-file counts", () => {
    const counts = countByFile([
      { file: "a.ts", line: 1, message: "" },
      { file: "a.ts", line: 9, message: "" },
      { file: "b.ts", line: 3, message: "" },
    ]);
    expect(counts).toEqual({ "a.ts": 2, "b.ts": 1 });
  });
});

describe("compareToBaseline", () => {
  test("reports a new silent catch as a regression", () => {
    const drift = compareToBaseline({ "a.ts": 2 }, { "a.ts": 1 });
    expect(drift.regressions).toEqual([
      { file: "a.ts", baseline: 1, actual: 2 },
    ]);
    expect(drift.improvements).toEqual([]);
  });

  test("reports a file absent from the baseline as a regression", () => {
    const drift = compareToBaseline({ "new.ts": 1 }, {});
    expect(drift.regressions).toEqual([
      { file: "new.ts", baseline: 0, actual: 1 },
    ]);
  });

  test("reports a removed silent catch as an improvement (stale baseline)", () => {
    const drift = compareToBaseline({ "a.ts": 1 }, { "a.ts": 3 });
    expect(drift.improvements).toEqual([
      { file: "a.ts", baseline: 3, actual: 1 },
    ]);
    expect(drift.regressions).toEqual([]);
  });

  test("reports no drift when counts match", () => {
    const drift = compareToBaseline({ "a.ts": 2 }, { "a.ts": 2 });
    expect(drift.regressions).toEqual([]);
    expect(drift.improvements).toEqual([]);
  });
});

describe("check-error-patterns (subprocess)", () => {
  test("passes against the current source tree and committed baseline", () => {
    const result = runCheck();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("No error class anti-patterns found");
  });
});
