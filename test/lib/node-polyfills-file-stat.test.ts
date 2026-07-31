/**
 * CLI-1EA / CLI-1EB regression: the npm distribution's Bun.file() polyfill
 * was missing `.stat()`, causing every DSN auto-detection call on Node to
 * throw `TypeError: Bun.file(...).stat is not a function`.
 *
 * This file lives under `test/lib/` so it's picked up by `bun run test:unit`
 * (the primary `test/script/node-polyfills.test.ts` is outside the CI
 * globs — see the "test:unit glob" gotcha in AGENTS.md).
 *
 * We reproduce the minimal shape of the polyfill inline to mirror the test
 * pattern in `test/script/node-polyfills.test.ts`. If the polyfill's
 * `.stat()` shim changes shape in `script/node-polyfills.ts`, update this
 * reproduction too.
 */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Mirrors the `.stat` member of the object returned by
 * `BunPolyfill.file(path)` in `script/node-polyfills.ts`.
 */
function polyfillFileStat(
  path: string
): () => Promise<import("node:fs").Stats> {
  // Follows symlinks (stat, not lstat) — matches Bun.file().stat() semantics.
  return stat.bind(null, path);
}

describe("node polyfill Bun.file().stat() (CLI-1EA, CLI-1EB)", () => {
  test("regular file resolves with isFile()=true", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "polyfill-stat-"));
    const filePath = join(tmpDir, "regular.txt");
    try {
      writeFileSync(filePath, "hello");
      const stats = await polyfillFileStat(filePath)();
      expect(stats.isFile()).toBe(true);
      expect(stats.isDirectory()).toBe(false);
      expect(stats.size).toBe(5);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("directory resolves with isDirectory()=true, isFile()=false", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "polyfill-stat-"));
    try {
      const stats = await polyfillFileStat(tmpDir)();
      expect(stats.isDirectory()).toBe(true);
      expect(stats.isFile()).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("non-existent path rejects with ENOENT", async () => {
    const statFn = polyfillFileStat("/tmp/__nonexistent_cli_1ea_test__");
    try {
      await statFn();
      throw new Error("expected stat to reject");
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe("ENOENT");
    }
  });

  test("follows symlinks (returns target type, matches Bun.file().stat())", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "polyfill-stat-"));
    const targetPath = join(tmpDir, "target.txt");
    const linkPath = join(tmpDir, "link.txt");
    try {
      writeFileSync(targetPath, "data");
      execSync(
        `ln -s ${JSON.stringify(targetPath)} ${JSON.stringify(linkPath)}`
      );
      const stats = await polyfillFileStat(linkPath)();
      // stat (not lstat) follows the symlink; we must see the regular file.
      expect(stats.isFile()).toBe(true);
      expect(stats.isSymbolicLink()).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("parity with native stat()", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "polyfill-stat-"));
    const filePath = join(tmpDir, "compare.txt");
    try {
      writeFileSync(filePath, "compare");
      const polyfillStats = await polyfillFileStat(filePath)();
      const nativeStats = await stat(filePath);
      expect(polyfillStats.isFile()).toBe(nativeStats.isFile());
      expect(polyfillStats.isDirectory()).toBe(nativeStats.isDirectory());
      expect(polyfillStats.size).toBe(nativeStats.size);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
