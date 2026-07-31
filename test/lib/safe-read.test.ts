/**
 * FIFO-safety tests for the `safeReadFile` helper and the migrated
 * call sites. Parallels `test/lib/dsn/fifo-safety.test.ts` (added by
 * PR #806) — extends coverage to the non-DSN read paths addressed by
 * Group D unification.
 */

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { applyPatchset } from "../../src/lib/init/tools/apply-patchset.js";
import { readFiles } from "../../src/lib/init/tools/read-files.js";
import type { DirEntry } from "../../src/lib/init/types.js";
import { preReadCommonFiles } from "../../src/lib/init/workflow-inputs.js";
import { safeReadFile } from "../../src/lib/safe-read.js";
import {
  clearSentryCliRcCache,
  loadSentryCliRc,
} from "../../src/lib/sentryclirc.js";

/** Create a FIFO (named pipe) at the given path using mkfifo(1). */
function createFifo(path: string): void {
  execSync(`mkfifo ${JSON.stringify(path)}`);
}

describe("safeReadFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `safe-read-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("reads regular file content", async () => {
    const path = join(dir, "config.ini");
    writeFileSync(path, "[defaults]\norg=acme\n");
    expect(await safeReadFile(path, "test")).toBe("[defaults]\norg=acme\n");
  });

  test("returns null for missing files", async () => {
    expect(await safeReadFile(join(dir, "missing"), "test")).toBeNull();
  });

  test("returns null for FIFOs instead of blocking", async () => {
    const fifo = join(dir, "pipe.ini");
    createFifo(fifo);
    // If the guard weren't in place this would hang indefinitely.
    // Bun's test timeout would eventually fail the test, but we
    // should get a clean `null` return almost immediately.
    expect(await safeReadFile(fifo, "test")).toBeNull();
  });

  test("returns null for symlinks to FIFOs (1Password pattern)", async () => {
    const fifo = join(dir, "pipe");
    const link = join(dir, "linked.env");
    createFifo(fifo);
    execSync(`ln -s ${JSON.stringify(fifo)} ${JSON.stringify(link)}`);
    expect(await safeReadFile(link, "test")).toBeNull();
  });

  test("returns null for directories", async () => {
    const subdir = join(dir, "sub");
    mkdirSync(subdir);
    expect(await safeReadFile(subdir, "test")).toBeNull();
  });
});

describe("sentryclirc FIFO safety", () => {
  let dir: string;
  let originalHome: string | undefined;
  let originalSentryConfigDir: string | undefined;

  beforeEach(() => {
    // Clear both the load cache AND the cached global-paths singleton
    // so this describe block sees the overridden env vars below.
    clearSentryCliRcCache();
    dir = join(
      tmpdir(),
      `sentryclirc-fifo-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(dir, { recursive: true });
    // Point both global fallback locations into `dir` so the loader
    // can't reach the real user's `$HOME/.sentryclirc`.
    originalHome = process.env.HOME;
    originalSentryConfigDir = process.env.SENTRY_CONFIG_DIR;
    process.env.HOME = dir;
    process.env.SENTRY_CONFIG_DIR = dir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.SENTRY_CONFIG_DIR = originalSentryConfigDir;
    rmSync(dir, { recursive: true, force: true });
    // Reset again so later test files don't inherit stale globalPaths
    // pointing at the now-deleted temp dir.
    clearSentryCliRcCache();
  });

  test("skips a `.sentryclirc` FIFO in the project tree without hanging", async () => {
    // Simulate a 1Password-managed `.sentryclirc` (unusual but
    // possible). The walk-up should emit a null and move on — not
    // hang on the FIFO read.
    const cwd = join(dir, "project");
    mkdirSync(cwd);
    createFifo(join(cwd, ".sentryclirc"));

    const config = await loadSentryCliRc(cwd);
    // No config values resolved, but the function returned cleanly.
    expect(config.org).toBeUndefined();
    expect(config.project).toBeUndefined();
  });
});

describe("init read-files FIFO safety", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `readfiles-fifo-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns null entry for a FIFO path instead of hanging", async () => {
    writeFileSync(join(dir, "real.ts"), "export {};\n");
    createFifo(join(dir, ".env"));

    const result = await readFiles({
      type: "tool",
      operation: "read-files",
      cwd: dir,
      params: { paths: ["real.ts", ".env"] },
    });

    expect(result.ok).toBe(true);
    const files = (result.data as { files: Record<string, string | null> })
      .files;
    expect(files["real.ts"]).toBe("export {};\n");
    expect(files[".env"]).toBeNull();
  });

  test("returns null entry for a symlink to a FIFO (1Password pattern)", async () => {
    // 1Password's `.env` integration uses a symlink → FIFO to stream
    // secrets. `stat` follows the symlink so `isFile()` is false on
    // the FIFO target, correctly rejected by the guard.
    const fifo = join(dir, ".env-pipe");
    const link = join(dir, ".env");
    createFifo(fifo);
    execSync(`ln -s ${JSON.stringify(fifo)} ${JSON.stringify(link)}`);

    const result = await readFiles({
      type: "tool",
      operation: "read-files",
      cwd: dir,
      params: { paths: [".env"] },
    });

    expect(result.ok).toBe(true);
    const files = (result.data as { files: Record<string, string | null> })
      .files;
    expect(files[".env"]).toBeNull();
  });
});

describe("init apply-patchset FIFO safety", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `applypatch-fifo-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("throws targeted error for a FIFO target instead of hanging", async () => {
    createFifo(join(dir, "config.ts"));

    await expect(
      applyPatchset(
        {
          type: "tool",
          operation: "apply-patchset",
          cwd: dir,
          params: {
            patches: [
              {
                action: "modify",
                path: "config.ts",
                edits: [{ oldString: "foo", newString: "bar" }],
              },
            ],
          },
        },
        { dryRun: false, authToken: undefined }
      )
    ).rejects.toThrow(/not a regular file|read failed/);
  });

  test("throws targeted error for a symlink to a FIFO", async () => {
    const fifo = join(dir, "config.pipe");
    const link = join(dir, "config.ts");
    createFifo(fifo);
    execSync(`ln -s ${JSON.stringify(fifo)} ${JSON.stringify(link)}`);

    await expect(
      applyPatchset(
        {
          type: "tool",
          operation: "apply-patchset",
          cwd: dir,
          params: {
            patches: [
              {
                action: "modify",
                path: "config.ts",
                edits: [{ oldString: "foo", newString: "bar" }],
              },
            ],
          },
        },
        { dryRun: false, authToken: undefined }
      )
    ).rejects.toThrow(/not a regular file|read failed/);
  });
});

describe("workflow-inputs preReadCommonFiles FIFO safety", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `preread-fifo-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns null entry for a FIFO-backed common-config file", async () => {
    writeFileSync(join(dir, "package.json"), '{"name":"x"}');
    // `tsconfig.json` is in `COMMON_CONFIG_FILES` but exists here as
    // a FIFO. Without the `stat.isFile()` guard the read would hang.
    createFifo(join(dir, "tsconfig.json"));

    const listing: DirEntry[] = [
      { name: "package.json", path: "package.json", type: "file" },
      { name: "tsconfig.json", path: "tsconfig.json", type: "file" },
    ];
    const cache = await preReadCommonFiles(dir, listing);
    expect(cache["package.json"]).toBe('{"name":"x"}');
    expect(cache["tsconfig.json"]).toBeNull();
  });
});
