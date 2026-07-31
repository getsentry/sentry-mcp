/**
 * Unit tests for the byte-driven upgrade progress reporter.
 *
 * The reporter is cosmetic-only and must never abort the operation it
 * decorates. It feeds a `setMessage` callback (the surrounding withProgress
 * spinner) rather than drawing its own bar, so there's no second in-place
 * redraw competing with the spinner.
 *
 * Coverage: determinate vs indeterminate formatting, byte accumulation,
 * full-bar clamping, update throttling, a final un-throttled done() emit, the
 * no-op path when no setMessage is provided, and the never-throws contract.
 */

import { describe, expect, test, vi } from "vitest";

import { makeByteProgress } from "../../src/lib/progress.js";

describe("makeByteProgress", () => {
  test("formats a determinate bar with size and percent", () => {
    const msgs: string[] = [];
    let now = 0;
    const p = makeByteProgress(
      "Applying 3 patch(es)",
      1000,
      (m) => msgs.push(m),
      () => now
    );
    p.onProgress(500); // first call: now=0, lastEmit=0 → throttled (0-0 < 100)
    now = 200;
    p.onProgress(500); // now past throttle → emits at 1000/1000
    const last = msgs.at(-1) ?? "";
    expect(last).toContain("Applying 3 patch(es)");
    expect(last).toContain("1000 B / 1000 B");
    expect(last).toContain("100%");
    expect(last).toContain("█".repeat(16));
  });

  test("formats an indeterminate byte counter when total is null", () => {
    const msgs: string[] = [];
    let now = 0;
    const p = makeByteProgress(
      "Downloading",
      null,
      (m) => msgs.push(m),
      () => now
    );
    now = 200;
    p.onProgress(2048);
    const last = msgs.at(-1) ?? "";
    expect(last).toContain("Downloading");
    expect(last).toContain("2.0 KB");
    expect(last).not.toContain("░"); // no bar in indeterminate mode
  });

  test("accumulates bytes across calls and clamps the bar at full", () => {
    const msgs: string[] = [];
    let now = 0;
    const p = makeByteProgress(
      "Applying",
      100,
      (m) => msgs.push(m),
      () => now
    );
    p.onProgress(50);
    now = 500;
    p.onProgress(9000); // way over total → clamp to 100%
    const last = msgs.at(-1) ?? "";
    expect(last).toContain("100%");
    expect(last).toContain("█".repeat(16));
    expect(last).not.toContain("░");
  });

  test("throttles updates so a fast byte stream doesn't spam the spinner", () => {
    const set = vi.fn();
    const now = 1000;
    const p = makeByteProgress("Applying", 1000, set, () => now);
    // Many calls within the same throttle window → at most one emit.
    for (let i = 0; i < 50; i++) {
      p.onProgress(10);
    }
    expect(set.mock.calls.length).toBeLessThanOrEqual(1);
  });

  test("done() emits a final, un-throttled message reflecting the total", () => {
    const set = vi.fn();
    const now = 0;
    const p = makeByteProgress("Applying", 100, set, () => now);
    p.onProgress(100); // throttled (now-0 < 100), no emit yet
    set.mockClear();
    p.done(); // must emit regardless of throttle
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]?.[0]).toContain("100%");
  });

  test("is a no-op when no setMessage is provided (JSON/non-TTY)", () => {
    // Nothing to assert beyond: it must not throw and must still track bytes
    // so a later done() with a setMessage-less reporter is harmless.
    const p = makeByteProgress("Applying", 100);
    expect(() => {
      p.onProgress(50);
      p.done();
    }).not.toThrow();
  });

  test("never throws even if setMessage throws", () => {
    const p = makeByteProgress(
      "Applying",
      100,
      () => {
        throw new Error("boom");
      },
      () => 1000
    );
    expect(() => {
      p.onProgress(100);
      p.done();
    }).not.toThrow();
  });
});
