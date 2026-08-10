/**
 * Tests for the strict-by-default zero-pairs behavior on `sentry
 * sourcemap inject` / `upload`, including the per-shape diagnostic
 * branches in `buildEmptyDiscoveryError`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { injectCommand } from "../../../src/commands/sourcemap/inject.js";
import { uploadCommand } from "../../../src/commands/sourcemap/upload.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as sourcemapsApi from "../../../src/lib/api/sourcemaps.js";
import { ValidationError } from "../../../src/lib/errors.js";

type InjectFuncArgs = {
  ext?: string;
  "dry-run"?: boolean;
  "allow-empty"?: boolean;
};
type UploadFuncArgs = {
  release?: string;
  dist?: string;
  "url-prefix"?: string;
  ext?: string;
  ignore?: string;
  "ignore-file"?: string;
  "strip-prefix"?: string;
  "strip-common-prefix"?: boolean;
  "no-rewrite"?: boolean;
  "allow-empty"?: boolean;
};
type CmdFunc<A> = (this: unknown, flags: A, dir: string) => Promise<unknown>;

function makeContext() {
  return {
    stdout: { write: vi.fn(() => true) },
    stderr: { write: vi.fn(() => true) },
    cwd: "/tmp",
  };
}

describe("sourcemap inject command — --allow-empty behavior", () => {
  let dir: string;
  let func: CmdFunc<InjectFuncArgs>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "sentry-inject-cmd-"));
    func = (await injectCommand.loader()) as unknown as CmdFunc<InjectFuncArgs>;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("empty directory: throws actionable ValidationError", async () => {
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, dir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain(dir);
      expect(msg).toContain("--allow-empty");
      expect(msg).toMatch(/no JS or sourcemap files/i);
    }
  });

  test("empty directory with --allow-empty: succeeds silently", async () => {
    const ctx = makeContext();
    await expect(
      func.call(ctx, { "allow-empty": true }, dir)
    ).resolves.toBeUndefined();
  });

  test("directory with a .js + .map pair: succeeds (0 pairs guard not triggered)", async () => {
    writeFileSync(join(dir, "app.js"), "console.log(1)\n");
    writeFileSync(join(dir, "app.js.map"), '{"version":3}\n');
    const ctx = makeContext();
    await expect(func.call(ctx, {}, dir)).resolves.toBeUndefined();
  });

  test(".js files without matching .map files: throws with bundler hint", async () => {
    writeFileSync(join(dir, "app.js"), "console.log(1)\n");
    writeFileSync(join(dir, "other.js"), "console.log(2)\n");
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, dir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain("2 JS file(s)");
      expect(msg).toMatch(/vite|webpack/i);
      expect(msg).toContain("sourcemap");
    }
  });

  test(".map files without matching .js files: throws with mismatch hint", async () => {
    writeFileSync(join(dir, "app.js.map"), '{"version":3}\n');
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, dir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain(".map file(s)");
      expect(msg).toContain("no companion JS");
    }
  });

  test("js and map present but no basename match: reports both counts", async () => {
    writeFileSync(join(dir, "app.abc123.js"), "console.log(1)\n");
    writeFileSync(join(dir, "app.js.map"), '{"version":3}\n');
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, dir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain("1 JS");
      expect(msg).toContain("1 .map");
      expect(msg).toContain("matching basename");
    }
  });

  test("non-existent directory: throws with distinct 'does not exist' message", async () => {
    const missing = join(dir, "does-not-exist");
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, missing);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain(missing);
      expect(msg).toMatch(/does not exist/i);
      expect(msg).not.toContain("--allow-empty");
    }
  });

  test("path is a file, not a directory: throws with distinct message", async () => {
    const filePath = join(dir, "not-a-dir.txt");
    writeFileSync(filePath, "hello\n");
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, filePath);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain(filePath);
      expect(msg).toMatch(/not a directory/i);
    }
  });

  test("--dry-run + empty directory: still errors (dry-run is not an escape hatch)", async () => {
    const ctx = makeContext();
    await expect(
      func.call(ctx, { "dry-run": true }, dir)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("--dry-run + --allow-empty: succeeds silently", async () => {
    const ctx = makeContext();
    await expect(
      func.call(ctx, { "dry-run": true, "allow-empty": true }, dir)
    ).resolves.toBeUndefined();
  });

  test("sourceMappingURL: follows external map reference when convention fails", async () => {
    // JS file with sourceMappingURL pointing to a differently-named map
    writeFileSync(
      join(dir, "bundle.js"),
      "console.log(1)\n//# sourceMappingURL=bundle.abc123.js.map\n"
    );
    // Map file with non-convention name (no bundle.js.map exists)
    writeFileSync(
      join(dir, "bundle.abc123.js.map"),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })
    );
    const ctx = makeContext();
    await expect(func.call(ctx, {}, dir)).resolves.toBeUndefined();
  });

  test("sourceMappingURL: prefers convention naming over directive", async () => {
    // JS file with sourceMappingURL pointing to a different file
    writeFileSync(
      join(dir, "app.js"),
      "console.log(1)\n//# sourceMappingURL=other.js.map\n"
    );
    // Convention map exists — should be used
    writeFileSync(
      join(dir, "app.js.map"),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })
    );
    // The directive target also exists
    writeFileSync(
      join(dir, "other.js.map"),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })
    );
    const ctx = makeContext();
    // Should succeed (convention-based match found first)
    await expect(func.call(ctx, {}, dir)).resolves.toBeUndefined();
  });

  test("sourceMappingURL: valid inline data: URL is injected (1 pair)", async () => {
    // eyJ2ZXJzaW9uIjozfQ== === {"version":3}
    writeFileSync(
      join(dir, "inline.js"),
      "console.log(1)\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==\n"
    );
    // No convention map — the inline map is discovered as a pair and injected.
    const ctx = makeContext();
    await expect(func.call(ctx, {}, dir)).resolves.toBeUndefined();
  });

  test("sourceMappingURL: invalid inline base64 is skipped (zero pairs)", async () => {
    writeFileSync(
      join(dir, "bad-inline.js"),
      "console.log(1)\n//# sourceMappingURL=data:application/json;base64,@@@not-base64@@@\n"
    );
    // Non-fatal skip → no pairs → actionable ValidationError, not a crash.
    const ctx = makeContext();
    await expect(func.call(ctx, {}, dir)).rejects.toBeInstanceOf(
      ValidationError
    );
  });
});

describe("sourcemap upload command — --allow-empty behavior", () => {
  let dir: string;
  let func: CmdFunc<UploadFuncArgs>;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "sentry-upload-cmd-"));
    // Short-circuit resolveOrgAndProject so tests don't need DSN/config.
    savedEnv = {
      SENTRY_ORG: process.env.SENTRY_ORG,
      SENTRY_PROJECT: process.env.SENTRY_PROJECT,
    };
    process.env.SENTRY_ORG = "test-org";
    process.env.SENTRY_PROJECT = "test-project";
    func = (await uploadCommand.loader()) as unknown as CmdFunc<UploadFuncArgs>;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  test("empty directory: throws actionable ValidationError", async () => {
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, dir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain(dir);
      expect(msg).toContain("--allow-empty");
    }
  });

  test("empty directory with --allow-empty: succeeds silently", async () => {
    const ctx = makeContext();
    await expect(
      func.call(ctx, { "allow-empty": true }, dir)
    ).resolves.toBeUndefined();
  });

  test("empty directory with --allow-empty: does not require credentials", async () => {
    // The library-only / conditional-release-skip cases named in the
    // docs may run without DSN/org/project context. With nothing to
    // upload, the command must not insist on resolving them.
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;
    const ctx = makeContext();
    await expect(
      func.call(ctx, { "allow-empty": true }, dir)
    ).resolves.toBeUndefined();
  });

  test("directory with .js files but no .map files: throws", async () => {
    mkdirSync(join(dir, "_astro"));
    writeFileSync(join(dir, "_astro", "app.js"), "console.log(1)\n");
    const ctx = makeContext();
    await expect(func.call(ctx, {}, dir)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  test("non-existent directory: throws before resolving org/project", async () => {
    // Cleared so the dir-check has to fire first to produce a useful error.
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;
    const missing = join(dir, "does-not-exist");
    const ctx = makeContext();
    try {
      await func.call(ctx, {}, missing);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/does not exist/i);
    }
  });

  test("error path does not mutate files (js-only dir)", async () => {
    // Discovery must be read-only — injection only runs once we've
    // decided the upload will proceed.
    mkdirSync(join(dir, "_astro"));
    const jsPath = join(dir, "_astro", "app.js");
    const original = "console.log(1)\n";
    writeFileSync(jsPath, original);
    const ctx = makeContext();
    await expect(func.call(ctx, {}, dir)).rejects.toBeInstanceOf(
      ValidationError
    );
    const after = await readFile(jsPath, "utf-8");
    expect(after).toBe(original);
    expect(after).not.toContain("_sentryDebugIds");
    expect(after).not.toContain("sentry-dbid");
  });

  test("happy path: directory with JS+map pair invokes uploadSourcemaps", async () => {
    mkdirSync(join(dir, "_astro"));
    const jsPath = join(dir, "_astro", "app.js");
    const mapPath = join(dir, "_astro", "app.js.map");
    writeFileSync(jsPath, "console.log(1)\n");
    writeFileSync(
      mapPath,
      JSON.stringify({
        version: 3,
        sources: ["app.ts"],
        names: [],
        mappings: "",
      })
    );

    const uploadSpy = vi
      .spyOn(sourcemapsApi, "uploadSourcemaps")
      .mockResolvedValue(undefined);
    try {
      const ctx = makeContext();
      await func.call(ctx, {}, dir);
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      const callArgs = uploadSpy.mock.calls[0]?.[0];
      expect(callArgs?.org).toBe("test-org");
      expect(callArgs?.project).toBe("test-project");
      expect(callArgs?.files).toHaveLength(2);
      const types = callArgs?.files.map((f) => f.type);
      expect(types).toContain("minified_source");
      expect(types).toContain("source_map");
    } finally {
      uploadSpy.mockRestore();
    }
  });

  test("inline sourcemap: uploads decoded map as a source_map with content", async () => {
    const jsPath = join(dir, "inline.js");
    const map = { version: 3, sources: ["a.ts"], names: [], mappings: "AAAA" };
    const dataUrl = `data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}`;
    writeFileSync(jsPath, `console.log(1)\n//# sourceMappingURL=${dataUrl}\n`);

    const uploadSpy = vi
      .spyOn(sourcemapsApi, "uploadSourcemaps")
      .mockResolvedValue(undefined);
    try {
      const ctx = makeContext();
      await func.call(ctx, {}, dir);
      const files = uploadSpy.mock.calls[0]?.[0]?.files ?? [];
      expect(files).toHaveLength(2);
      const js = files.find((f) => f.type === "minified_source");
      const mapFile = files.find((f) => f.type === "source_map");
      // The source_map entry carries in-memory content (no .map on disk).
      expect(mapFile?.content).toBeInstanceOf(Buffer);
      // Both entries share the injected debug ID.
      expect(js?.debugId).toBeTruthy();
      expect(mapFile?.debugId).toBe(js?.debugId);
      // The uploaded map carries the injected debug ID.
      const uploaded = JSON.parse(
        (mapFile?.content as Buffer).toString("utf-8")
      );
      expect(uploaded.debug_id).toBe(js?.debugId);
    } finally {
      uploadSpy.mockRestore();
    }
  });

  test("--no-rewrite + inline map: uploads original map without debug ID", async () => {
    const jsPath = join(dir, "inline-norw.js");
    const map = { version: 3, sources: ["b.ts"], names: [], mappings: "BBBB" };
    const dataUrl = `data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}`;
    writeFileSync(jsPath, `console.log(1)\n//# sourceMappingURL=${dataUrl}\n`);

    const uploadSpy = vi
      .spyOn(sourcemapsApi, "uploadSourcemaps")
      .mockResolvedValue(undefined);
    try {
      const ctx = makeContext();
      await func.call(ctx, { "no-rewrite": true }, dir);
      const files = uploadSpy.mock.calls[0]?.[0]?.files ?? [];
      expect(files).toHaveLength(2);
      const js = files.find((f) => f.type === "minified_source");
      const mapFile = files.find((f) => f.type === "source_map");
      // No debug ID injected — relying on release/URL matching.
      expect(js?.debugId).toBeUndefined();
      expect(mapFile?.debugId).toBeUndefined();
      // The source_map entry carries the original (un-injected) map content.
      expect(mapFile?.content).toBeInstanceOf(Buffer);
      const uploaded = JSON.parse(
        (mapFile?.content as Buffer).toString("utf-8")
      );
      expect(uploaded.version).toBe(3);
      expect(uploaded.debug_id).toBeUndefined();
    } finally {
      uploadSpy.mockRestore();
    }
  });

  test("--dist flag: passes dist to uploadSourcemaps", async () => {
    mkdirSync(join(dir, "_astro"));
    writeFileSync(join(dir, "_astro", "app.js"), "console.log(1)\n");
    writeFileSync(
      join(dir, "_astro", "app.js.map"),
      JSON.stringify({
        version: 3,
        sources: ["app.ts"],
        names: [],
        mappings: "",
      })
    );

    const uploadSpy = vi
      .spyOn(sourcemapsApi, "uploadSourcemaps")
      .mockResolvedValue(undefined);
    try {
      const ctx = makeContext();
      await func.call(ctx, { release: "1.0.0", dist: "12345" }, dir);
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      const callArgs = uploadSpy.mock.calls[0]?.[0];
      expect(callArgs?.dist).toBe("12345");
      expect(callArgs?.release).toBe("1.0.0");
    } finally {
      uploadSpy.mockRestore();
    }
  });

  test("--no-rewrite: uploads without injecting debug IDs", async () => {
    mkdirSync(join(dir, "_astro"));
    const jsPath = join(dir, "_astro", "app.js");
    const mapPath = join(dir, "_astro", "app.js.map");
    const originalJs = "console.log(1)\n";
    writeFileSync(jsPath, originalJs);
    writeFileSync(
      mapPath,
      JSON.stringify({
        version: 3,
        sources: ["app.ts"],
        names: [],
        mappings: "",
      })
    );

    const uploadSpy = vi
      .spyOn(sourcemapsApi, "uploadSourcemaps")
      .mockResolvedValue(undefined);
    try {
      const ctx = makeContext();
      await func.call(ctx, { "no-rewrite": true }, dir);
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      const callArgs = uploadSpy.mock.calls[0]?.[0];
      // Files should have no debugId when --no-rewrite is used
      for (const file of callArgs?.files ?? []) {
        expect(file.debugId).toBeUndefined();
      }
      // JS file should not have been modified
      const afterJs = await readFile(jsPath, "utf-8");
      expect(afterJs).toBe(originalJs);
      expect(afterJs).not.toContain("_sentryDebugIds");
    } finally {
      uploadSpy.mockRestore();
    }
  });

  test("--ext: discovers files with custom extensions", async () => {
    writeFileSync(join(dir, "app.ts"), "console.log(1)\n");
    writeFileSync(
      join(dir, "app.ts.map"),
      JSON.stringify({
        version: 3,
        sources: ["app.ts"],
        names: [],
        mappings: "",
      })
    );
    // A .js file that should NOT be discovered when --ext is .ts
    writeFileSync(join(dir, "other.js"), "console.log(2)\n");

    const uploadSpy = vi
      .spyOn(sourcemapsApi, "uploadSourcemaps")
      .mockResolvedValue(undefined);
    try {
      const ctx = makeContext();
      await func.call(ctx, { ext: ".ts" }, dir);
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      const callArgs = uploadSpy.mock.calls[0]?.[0];
      expect(callArgs?.files).toHaveLength(2);
      const urls = callArgs?.files.map((f) => f.url);
      expect(urls?.some((u) => u?.includes("app.ts"))).toBe(true);
      expect(urls?.some((u) => u?.includes("other.js"))).toBe(false);
    } finally {
      uploadSpy.mockRestore();
    }
  });

  test("--ignore: excludes matching files from upload", async () => {
    mkdirSync(join(dir, "vendor"));
    // File that should be excluded
    writeFileSync(join(dir, "vendor", "lib.js"), "console.log(1)\n");
    writeFileSync(
      join(dir, "vendor", "lib.js.map"),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })
    );
    // File that should be included
    writeFileSync(join(dir, "app.js"), "console.log(2)\n");
    writeFileSync(
      join(dir, "app.js.map"),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })
    );

    const uploadSpy = vi
      .spyOn(sourcemapsApi, "uploadSourcemaps")
      .mockResolvedValue(undefined);
    try {
      const ctx = makeContext();
      await func.call(ctx, { ignore: "vendor/**" }, dir);
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      const callArgs = uploadSpy.mock.calls[0]?.[0];
      // Only app.js pair should be uploaded (2 files: .js + .map)
      expect(callArgs?.files).toHaveLength(2);
      const urls = callArgs?.files.map((f) => f.url);
      expect(urls?.some((u) => u?.includes("app.js"))).toBe(true);
      expect(urls?.some((u) => u?.includes("vendor"))).toBe(false);
    } finally {
      uploadSpy.mockRestore();
    }
  });

  test("--ignore-file: reads patterns from a file", async () => {
    mkdirSync(join(dir, "vendor"));
    writeFileSync(join(dir, "vendor", "lib.js"), "console.log(1)\n");
    writeFileSync(
      join(dir, "vendor", "lib.js.map"),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })
    );
    writeFileSync(join(dir, "app.js"), "console.log(2)\n");
    writeFileSync(
      join(dir, "app.js.map"),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })
    );
    // Write an ignore file
    const ignoreFilePath = join(dir, ".sourcemapignore");
    writeFileSync(ignoreFilePath, "vendor/\n");

    const uploadSpy = vi
      .spyOn(sourcemapsApi, "uploadSourcemaps")
      .mockResolvedValue(undefined);
    try {
      const ctx = makeContext();
      await func.call(ctx, { "ignore-file": ignoreFilePath }, dir);
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      const callArgs = uploadSpy.mock.calls[0]?.[0];
      expect(callArgs?.files).toHaveLength(2);
      const urls = callArgs?.files.map((f) => f.url);
      expect(urls?.some((u) => u?.includes("app.js"))).toBe(true);
      expect(urls?.some((u) => u?.includes("vendor"))).toBe(false);
    } finally {
      uploadSpy.mockRestore();
    }
  });

  test("--ignore-file with non-existent file: throws ValidationError", async () => {
    writeFileSync(join(dir, "app.js"), "console.log(1)\n");
    writeFileSync(
      join(dir, "app.js.map"),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })
    );
    const ctx = makeContext();
    try {
      await func.call(ctx, { "ignore-file": join(dir, "nonexistent") }, dir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as Error).message).toContain("does not exist");
    }
  });

  test("--strip-prefix: removes explicit prefix from uploaded URLs", async () => {
    mkdirSync(join(dir, "static", "js"), { recursive: true });
    writeFileSync(join(dir, "static", "js", "app.js"), "console.log(1)\n");
    writeFileSync(
      join(dir, "static", "js", "app.js.map"),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })
    );

    const uploadSpy = vi
      .spyOn(sourcemapsApi, "uploadSourcemaps")
      .mockResolvedValue(undefined);
    try {
      const ctx = makeContext();
      await func.call(ctx, { "strip-prefix": "static/js/" }, dir);
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      const callArgs = uploadSpy.mock.calls[0]?.[0];
      const urls = callArgs?.files.map((f) => f.url);
      // Prefix stripped: "~/app.js" instead of "~/static/js/app.js"
      expect(urls).toContain("~/app.js");
      expect(urls).toContain("~/app.js.map");
    } finally {
      uploadSpy.mockRestore();
    }
  });

  test("--strip-common-prefix: auto-strips shared directory prefix", async () => {
    mkdirSync(join(dir, "build", "output"), { recursive: true });
    writeFileSync(join(dir, "build", "output", "main.js"), "console.log(1)\n");
    writeFileSync(
      join(dir, "build", "output", "main.js.map"),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })
    );
    writeFileSync(
      join(dir, "build", "output", "vendor.js"),
      "console.log(2)\n"
    );
    writeFileSync(
      join(dir, "build", "output", "vendor.js.map"),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })
    );

    const uploadSpy = vi
      .spyOn(sourcemapsApi, "uploadSourcemaps")
      .mockResolvedValue(undefined);
    try {
      const ctx = makeContext();
      await func.call(ctx, { "strip-common-prefix": true }, dir);
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      const callArgs = uploadSpy.mock.calls[0]?.[0];
      const urls = callArgs?.files.map((f) => f.url);
      // Common prefix "build/output/" stripped: "~/main.js", "~/vendor.js"
      expect(urls).toContain("~/main.js");
      expect(urls).toContain("~/vendor.js");
      expect(urls?.some((u) => u?.includes("build"))).toBe(false);
    } finally {
      uploadSpy.mockRestore();
    }
  });

  test("--strip-prefix + --strip-common-prefix: mutually exclusive", async () => {
    writeFileSync(join(dir, "app.js"), "console.log(1)\n");
    writeFileSync(
      join(dir, "app.js.map"),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })
    );
    const ctx = makeContext();
    await expect(
      func.call(
        ctx,
        { "strip-prefix": "foo/", "strip-common-prefix": true },
        dir
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("sourceMappingURL: last directive wins over earlier ones", async () => {
    // Simulates a concatenated bundle with two directives in the tail.
    // No convention map (concat.js.map) exists, so discovery falls back
    // to sourceMappingURL. The last directive should win.
    writeFileSync(
      join(dir, "concat.js"),
      "console.log(1)\n" +
        "//# sourceMappingURL=wrong.js.map\n" +
        "console.log(2)\n" +
        "//# sourceMappingURL=correct.js.map\n"
    );
    writeFileSync(
      join(dir, "correct.js.map"),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })
    );
    // wrong.js.map also exists — but the last directive should win
    writeFileSync(
      join(dir, "wrong.js.map"),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })
    );

    const uploadSpy = vi
      .spyOn(sourcemapsApi, "uploadSourcemaps")
      .mockResolvedValue(undefined);
    try {
      const ctx = makeContext();
      await func.call(ctx, {}, dir);
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      const callArgs = uploadSpy.mock.calls[0]?.[0];
      // Should have paired concat.js with correct.js.map (last directive)
      const urls = callArgs?.files.map((f) => f.url);
      expect(urls?.some((u) => u?.includes("correct.js.map"))).toBe(true);
      expect(urls?.some((u) => u?.includes("wrong.js.map"))).toBe(false);
    } finally {
      uploadSpy.mockRestore();
    }
  });
});
