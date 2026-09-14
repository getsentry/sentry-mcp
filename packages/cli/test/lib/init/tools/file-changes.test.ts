import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { applyPatchset } from "../../../../src/lib/init/tools/apply-patchset.js";
import { applyPreparedFileChanges } from "../../../../src/lib/init/tools/file-changes/apply.js";
import { prepareFileChanges } from "../../../../src/lib/init/tools/file-changes/prepare.js";

const AUTH_TOKEN = "sntrys_test_token_123";

function request(cwd: string, patches: Record<string, unknown>[]): unknown {
  return {
    cwd,
    operation: "apply-patchset",
    params: { patches },
    type: "tool",
  };
}

describe("apply file changes", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "init-file-changes-"));
  });

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  test("prepares the entire batch before writing any file", async () => {
    const result = await applyPatchset(
      request(directory, [
        { action: "create", patch: "created\n", path: "created.txt" },
        {
          action: "modify",
          edits: [{ newString: "new", oldString: "old" }],
          path: "missing.txt",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result).toMatchObject({
      data: {
        applied: [],
        failed: { code: "missing_file", path: "missing.txt" },
      },
      ok: false,
    });
    expect(() => readFileSync(path.join(directory, "created.txt"))).toThrow();
  });

  test("never overwrites an existing create target", async () => {
    const target = path.join(directory, "existing.txt");
    writeFileSync(target, "original\n");

    const result = await applyPatchset(
      request(directory, [
        { action: "create", patch: "replacement\n", path: "existing.txt" },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result).toMatchObject({
      data: { failed: { code: "already_exists" } },
      ok: false,
    });
    expect(readFileSync(target, "utf-8")).toBe("original\n");
  });

  test("dry-run performs real preparation without writing", async () => {
    const valid = await applyPatchset(
      request(directory, [
        { action: "create", patch: "preview\n", path: "preview.txt" },
      ]),
      { authToken: undefined, dryRun: true }
    );
    const invalid = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [{ newString: "new", oldString: "old" }],
          path: "missing.txt",
        },
      ]),
      { authToken: undefined, dryRun: true }
    );

    expect(valid).toMatchObject({ data: { dryRun: true }, ok: true });
    expect(invalid).toMatchObject({
      data: { failed: { code: "missing_file" } },
      ok: false,
    });
    expect(() => readFileSync(path.join(directory, "preview.txt"))).toThrow();
  });

  test("rejects fuzzy anchor matches instead of replacing different code", async () => {
    const target = path.join(directory, "setup.ts");
    const original = [
      "function setup() {",
      "  const actual = initializeProduction();",
      "  return actual;",
      "}",
    ].join("\n");
    writeFileSync(target, original);

    const result = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [
            {
              newString: "replacement();",
              oldString: [
                "function setup() {",
                "  const guessed = initializeTest();",
                "  return guessed;",
                "}",
              ].join("\n"),
            },
          ],
          path: "setup.ts",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result).toMatchObject({
      data: { failed: { code: "edit_not_found" } },
      ok: false,
    });
    expect(readFileSync(target, "utf-8")).toBe(original);
  });

  test("preserves CRLF and a UTF-8 BOM", async () => {
    const target = path.join(directory, "config.ts");
    writeFileSync(target, "\uFEFFfirst\r\nsecond\r\nthird\r\n");

    const result = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [{ newString: "changed\n", oldString: "second\n" }],
          path: "config.ts",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result.ok).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe(
      "\uFEFFfirst\r\nchanged\r\nthird\r\n"
    );
  });

  test("rejects a stale modify prepared from older content", async () => {
    const target = path.join(directory, "config.ts");
    writeFileSync(target, "const value = 1;\n");
    const prepared = await prepareFileChanges(directory, [
      {
        action: "modify",
        edits: [
          { newString: "const value = 2;", oldString: "const value = 1;" },
        ],
        path: "config.ts",
      },
    ]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    writeFileSync(target, "const value = 3;\n");

    const result = await applyPreparedFileChanges(prepared.changes, false);

    expect(result).toMatchObject({
      data: { failed: { code: "stale_content" } },
      ok: false,
    });
    expect(readFileSync(target, "utf-8")).toBe("const value = 3;\n");
  });

  test("rejects a same-content file replaced after preparation", async () => {
    const target = path.join(directory, "config.ts");
    const original = path.join(directory, "config.original.ts");
    writeFileSync(target, "const value = 1;\n");
    const prepared = await prepareFileChanges(directory, [
      {
        action: "modify",
        edits: [
          { newString: "const value = 2;", oldString: "const value = 1;" },
        ],
        path: "config.ts",
      },
    ]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    renameSync(target, original);
    writeFileSync(target, "const value = 1;\n");

    const result = await applyPreparedFileChanges(prepared.changes, false);

    expect(result).toMatchObject({
      data: { failed: { code: "stale_content" } },
      ok: false,
    });
    expect(readFileSync(target, "utf-8")).toBe("const value = 1;\n");
    expect(readFileSync(original, "utf-8")).toBe("const value = 1;\n");
  });

  test("reports unavoidable write-time partial application", async () => {
    const prepared = await prepareFileChanges(directory, [
      { action: "create", content: "first\n", path: "first.txt" },
      {
        action: "create",
        content: "second\n",
        path: "blocked/second.txt",
      },
    ]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    writeFileSync(path.join(directory, "blocked"), "not a directory\n");

    const result = await applyPreparedFileChanges(prepared.changes, false);

    expect(result).toMatchObject({
      data: {
        applied: [{ action: "create", path: "first.txt" }],
        failed: { code: "stale_content", path: "blocked/second.txt" },
      },
      ok: false,
    });
    expect(readFileSync(path.join(directory, "first.txt"), "utf-8")).toBe(
      "first\n"
    );
  });

  test.skipIf(process.platform === "win32")(
    "maps an I/O failure after an applied change to write_failed",
    async () => {
      const blockedDirectory = path.join(directory, "blocked");
      mkdirSync(blockedDirectory);
      const prepared = await prepareFileChanges(directory, [
        { action: "create", content: "first\n", path: "first.txt" },
        {
          action: "create",
          content: "second\n",
          path: "blocked/second.txt",
        },
      ]);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) {
        return;
      }
      chmodSync(blockedDirectory, 0o500);

      const result = await applyPreparedFileChanges(
        prepared.changes,
        false
      ).finally(() => chmodSync(blockedDirectory, 0o700));

      expect(result).toMatchObject({
        data: {
          applied: [{ action: "create", path: "first.txt" }],
          failed: { code: "write_failed", path: "blocked/second.txt" },
        },
        ok: false,
      });
      expect(existsSync(path.join(blockedDirectory, "second.txt"))).toBe(false);
    }
  );

  test("injects auth locally without returning it in tool data", async () => {
    const result = await applyPatchset(
      request(directory, [
        {
          action: "create",
          patch: "SENTRY_AUTH_TOKEN=\n",
          path: ".env.sentry-build-plugin",
        },
      ]),
      { authToken: AUTH_TOKEN, dryRun: false }
    );

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(AUTH_TOKEN);
    expect(
      readFileSync(path.join(directory, ".env.sentry-build-plugin"), "utf-8")
    ).toContain(AUTH_TOKEN);
  });

  test("rejects malformed and duplicate file-change requests", async () => {
    const malformed = await applyPatchset(
      request(directory, [{ action: "modify", edits: [], path: "config.ts" }]),
      { authToken: undefined, dryRun: false }
    );
    const duplicate = await applyPatchset(
      request(directory, [
        { action: "create", patch: "first", path: "same.txt" },
        { action: "create", patch: "second", path: "same.txt" },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(malformed).toMatchObject({ ok: false });
    expect(malformed.error).toContain("edits must not be empty");
    expect(duplicate).toMatchObject({
      data: { failed: { code: "duplicate_target" } },
      ok: false,
    });
  });

  test("preserves an existing file mode on modify", async () => {
    const target = path.join(directory, "script.sh");
    writeFileSync(target, "echo old\n");
    chmodSync(target, 0o755);

    const result = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [{ newString: "echo new", oldString: "echo old" }],
          path: "script.sh",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result.ok).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("echo new\n");
    expect(statSync(target).mode % 0o1000).toBe(0o755);
  });

  test("creates nested directories only during the apply phase", async () => {
    const prepared = await prepareFileChanges(directory, [
      { action: "create", content: "content\n", path: "nested/file.txt" },
    ]);
    expect(prepared.ok).toBe(true);
    expect(existsSync(path.join(directory, "nested"))).toBe(false);
    if (!prepared.ok) {
      return;
    }

    const result = await applyPreparedFileChanges(prepared.changes, false);

    expect(result.ok).toBe(true);
    expect(readFileSync(path.join(directory, "nested/file.txt"), "utf-8")).toBe(
      "content\n"
    );
  });

  test("keeps delete idempotent but refuses to delete a new target", async () => {
    const prepared = await prepareFileChanges(directory, [
      { action: "delete", path: "missing.txt" },
    ]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    writeFileSync(path.join(directory, "missing.txt"), "appeared\n");

    const result = await applyPreparedFileChanges(prepared.changes, false);

    expect(result).toMatchObject({
      data: { failed: { code: "stale_content" } },
      ok: false,
    });
    expect(readFileSync(path.join(directory, "missing.txt"), "utf-8")).toBe(
      "appeared\n"
    );
  });

  test("rejects ambiguous exact edits", async () => {
    const target = path.join(directory, "duplicate.txt");
    writeFileSync(target, "same\nsame\n");

    const result = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [{ newString: "changed", oldString: "same" }],
          path: "duplicate.txt",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result).toMatchObject({
      data: { failed: { code: "edit_ambiguous" } },
      ok: false,
    });
    expect(readFileSync(target, "utf-8")).toBe("same\nsame\n");
  });

  test("rejects overlapping and invalid no-op matches", async () => {
    writeFileSync(path.join(directory, "overlap.txt"), "aaa");

    const overlapping = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [{ newString: "b", oldString: "aa" }],
          path: "overlap.txt",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );
    const absentNoOp = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [{ newString: "missing", oldString: "missing" }],
          path: "overlap.txt",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(overlapping).toMatchObject({
      data: { failed: { code: "edit_ambiguous" } },
      ok: false,
    });
    expect(absentNoOp).toMatchObject({
      data: { failed: { code: "edit_not_found" } },
      ok: false,
    });
    expect(readFileSync(path.join(directory, "overlap.txt"), "utf-8")).toBe(
      "aaa"
    );
  });

  test("rejects ancestor and descendant targets before writing", async () => {
    const result = await applyPatchset(
      request(directory, [
        { action: "create", patch: "file", path: "nested" },
        { action: "create", patch: "child", path: "nested/child.txt" },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result).toMatchObject({
      data: { applied: [], failed: { code: "path_conflict" } },
      ok: false,
    });
    expect(existsSync(path.join(directory, "nested"))).toBe(false);
  });

  test("composes repeated modifies in their original order", async () => {
    const target = path.join(directory, "config.ts");
    writeFileSync(target, "const value = 1;\n");

    const result = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [
            { newString: "const value = 2;", oldString: "const value = 1;" },
          ],
          path: "config.ts",
        },
        {
          action: "modify",
          edits: [
            { newString: "const value = 3;", oldString: "const value = 2;" },
          ],
          path: "config.ts",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result.ok).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("const value = 3;\n");
  });

  test("revalidates path containment immediately before writing", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "init-file-outside-"));
    const prepared = await prepareFileChanges(directory, [
      { action: "create", content: "blocked\n", path: "nested/file.txt" },
    ]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    symlinkSync(outside, path.join(directory, "nested"));

    const result = await applyPreparedFileChanges(prepared.changes, false);

    expect(result).toMatchObject({
      data: { failed: { code: "stale_content" } },
      ok: false,
    });
    expect(existsSync(path.join(outside, "file.txt"))).toBe(false);
    rmSync(outside, { force: true, recursive: true });
  });

  test("rejects a project root symlink retargeted after preparation", async () => {
    const originalRoot = path.join(directory, "original");
    const outside = mkdtempSync(path.join(tmpdir(), "init-root-outside-"));
    const rootLink = path.join(directory, "project");
    mkdirSync(originalRoot);
    symlinkSync(originalRoot, rootLink);
    const prepared = await prepareFileChanges(rootLink, [
      { action: "create", content: "blocked\n", path: "file.txt" },
    ]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    rmSync(rootLink);
    symlinkSync(outside, rootLink);

    const result = await applyPreparedFileChanges(prepared.changes, false);

    expect(result).toMatchObject({
      data: { failed: { code: "stale_content" } },
      ok: false,
    });
    expect(existsSync(path.join(outside, "file.txt"))).toBe(false);
    rmSync(outside, { force: true, recursive: true });
  });

  test("rejects filesystem aliases that target the same file", async () => {
    const realDirectory = path.join(directory, "real");
    mkdirSync(realDirectory);
    symlinkSync(realDirectory, path.join(directory, "alias"));

    const result = await applyPatchset(
      request(directory, [
        { action: "create", patch: "first\n", path: "real/file.txt" },
        { action: "create", patch: "second\n", path: "alias/file.txt" },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result).toMatchObject({
      data: { applied: [], failed: { code: "path_conflict" } },
      ok: false,
    });
    expect(existsSync(path.join(realDirectory, "file.txt"))).toBe(false);
  });

  test.skipIf(process.platform === "win32")(
    "rejects hard-link aliases before writing",
    async () => {
      const first = path.join(directory, "first.txt");
      const second = path.join(directory, "second.txt");
      writeFileSync(first, "old\n");
      linkSync(first, second);

      const result = await applyPatchset(
        request(directory, [
          {
            action: "modify",
            edits: [{ newString: "first", oldString: "old" }],
            path: "first.txt",
          },
          {
            action: "modify",
            edits: [{ newString: "second", oldString: "old" }],
            path: "second.txt",
          },
        ]),
        { authToken: undefined, dryRun: false }
      );

      expect(result).toMatchObject({
        data: { applied: [], failed: { code: "path_conflict" } },
        ok: false,
      });
      expect(readFileSync(first, "utf-8")).toBe("old\n");
      expect(readFileSync(second, "utf-8")).toBe("old\n");
    }
  );

  test("uses exclusive create at apply time", async () => {
    const prepared = await prepareFileChanges(directory, [
      { action: "create", content: "new\n", path: "created-later.txt" },
    ]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    const target = path.join(directory, "created-later.txt");
    writeFileSync(target, "external\n");

    const result = await applyPreparedFileChanges(prepared.changes, false);

    expect(result).toMatchObject({
      data: { failed: { code: "stale_content" } },
      ok: false,
    });
    expect(readFileSync(target, "utf-8")).toBe("external\n");
  });

  test("applies a successful create, modify, and delete batch", async () => {
    writeFileSync(path.join(directory, "modify.txt"), "old\n");
    writeFileSync(path.join(directory, "delete.txt"), "remove\n");

    const result = await applyPatchset(
      request(directory, [
        { action: "create", patch: "created\n", path: "create.txt" },
        {
          action: "modify",
          edits: [{ newString: "new", oldString: "old" }],
          path: "modify.txt",
        },
        { action: "delete", path: "delete.txt" },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result.ok).toBe(true);
    expect(readFileSync(path.join(directory, "create.txt"), "utf-8")).toBe(
      "created\n"
    );
    expect(readFileSync(path.join(directory, "modify.txt"), "utf-8")).toBe(
      "new\n"
    );
    expect(existsSync(path.join(directory, "delete.txt"))).toBe(false);
  });

  test("rejects deleting content changed after preparation", async () => {
    const target = path.join(directory, "delete.txt");
    writeFileSync(target, "original\n");
    const prepared = await prepareFileChanges(directory, [
      { action: "delete", path: "delete.txt" },
    ]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    writeFileSync(target, "changed\n");

    const result = await applyPreparedFileChanges(prepared.changes, false);

    expect(result).toMatchObject({
      data: { failed: { code: "stale_content" } },
      ok: false,
    });
    expect(readFileSync(target, "utf-8")).toBe("changed\n");
  });

  test("does not expose source content in an edit failure", async () => {
    const secret = "PRIVATE_VALUE_NOT_FOR_TELEMETRY";
    writeFileSync(path.join(directory, "config.ts"), `${secret}\n`);

    const result = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [{ newString: "replacement", oldString: "missing" }],
          path: "config.ts",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  test("edits a multi-megabyte Sentry config from complete local content", async () => {
    const target = path.join(directory, "sentry.config.ts");
    const original = `${"// filler\n".repeat(120_000)}Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 1 });\nconst marker = "old";\n`;
    writeFileSync(target, original);

    const result = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [
            {
              newString: 'const marker = "new";',
              oldString: 'const marker = "old";',
            },
          ],
          path: "sentry.config.ts",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result.ok).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe(
      original.replace('const marker = "old";', 'const marker = "new";')
    );
  });

  test("rejects losing DSN source or a configured feature beyond the first page", async () => {
    const target = path.join(directory, "sentry.config.ts");
    const original = `${"// filler\n".repeat(5000)}Sentry.init({ dsn: process.env.SENTRY_DSN, enableLogs: true });\n`;
    writeFileSync(target, original);

    const dsnResult = await applyPatchset(
      request(directory, [
        { action: "create", patch: "created\n", path: "created.txt" },
        {
          action: "modify",
          edits: [
            {
              newString: 'dsn: "https://example.invalid/1"',
              oldString: "dsn: process.env.SENTRY_DSN",
            },
          ],
          path: "sentry.config.ts",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );
    const logsResult = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [{ newString: "", oldString: "enableLogs: true" }],
          path: "sentry.config.ts",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(dsnResult).toMatchObject({
      data: { applied: [], failed: { code: "existing_setup_preservation" } },
      ok: false,
    });
    expect(logsResult).toMatchObject({
      data: { applied: [], failed: { code: "existing_setup_preservation" } },
      ok: false,
    });
    expect(JSON.stringify(dsnResult)).not.toContain("SENTRY_DSN");
    expect(readFileSync(target, "utf-8")).toBe(original);
    expect(existsSync(path.join(directory, "created.txt"))).toBe(false);
  });

  test("preserves source-map values when moving them across files", async () => {
    const target = path.join(directory, "sentry.config.ts");
    const original = `${"// filler\n".repeat(5000)}sourceMapsUploadOptions: { org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT, authToken: process.env.SENTRY_AUTH_TOKEN, assets: ["dist/**"] },\n`;
    writeFileSync(target, original);
    const modern =
      'sourcemaps: {\n  org: process.env.SENTRY_ORG,\n  project: process.env.SENTRY_PROJECT,\n  authToken: process.env.SENTRY_AUTH_TOKEN,\n  assets: ["dist/**"]\n},\n';

    const result = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [
            {
              newString: "",
              oldString: original.slice(
                original.indexOf("sourceMapsUploadOptions")
              ),
            },
          ],
          path: "sentry.config.ts",
        },
        { action: "create", patch: modern, path: "sentry.build.config.ts" },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(readFileSync(target, "utf-8")).not.toContain(
      "sourceMapsUploadOptions"
    );
    expect(
      readFileSync(path.join(directory, "sentry.build.config.ts"), "utf-8")
    ).toBe(modern);
  });

  test("rejects deleting an existing Sentry setup file", async () => {
    const target = path.join(directory, "sentry.config.ts");
    writeFileSync(target, "Sentry.init({ dsn: process.env.SENTRY_DSN });\n");

    const result = await applyPatchset(
      request(directory, [{ action: "delete", path: "sentry.config.ts" }]),
      { authToken: undefined, dryRun: false }
    );

    expect(result).toMatchObject({
      data: { applied: [], failed: { code: "existing_setup_preservation" } },
      ok: false,
    });
    expect(existsSync(target)).toBe(true);
  });

  test("allows deleting documentation that only mentions Sentry", async () => {
    const target = path.join(directory, "README.md");
    writeFileSync(
      target,
      "Example: @sentry/nextjs with sourcemap.client and enableLogs.\n"
    );

    const result = await applyPatchset(
      request(directory, [{ action: "delete", path: "README.md" }]),
      { authToken: undefined, dryRun: false }
    );

    expect(result.ok).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  test("keeps every existing Sentry initialization in a multi-SDK file", async () => {
    const target = path.join(directory, "instrumentation.ts");
    const original =
      "Sentry.init({ integrations: [server] });\nSentry.init({ integrations: [worker] });\n";
    writeFileSync(target, original);

    const result = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [
            {
              newString: "",
              oldString: "Sentry.init({ integrations: [worker] });\n",
            },
          ],
          path: "instrumentation.ts",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result).toMatchObject({
      data: { applied: [], failed: { code: "existing_setup_preservation" } },
      ok: false,
    });
    expect(readFileSync(target, "utf-8")).toBe(original);
  });

  test("does not let another changed file mask a removed initialization", async () => {
    const server = path.join(directory, "server.ts");
    const worker = path.join(directory, "worker.ts");
    writeFileSync(server, "Sentry.init({ integrations: [server] });\n");
    writeFileSync(worker, "Sentry.init({ integrations: [worker] });\n");

    const result = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [
            {
              newString: "",
              oldString: "Sentry.init({ integrations: [server] });\n",
            },
          ],
          path: "server.ts",
        },
        {
          action: "modify",
          edits: [
            {
              newString: "Sentry.init({ integrations: [worker] });",
              oldString: "Sentry.init({ integrations: [worker] });",
            },
          ],
          path: "worker.ts",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result).toMatchObject({
      data: { applied: [], failed: { code: "existing_setup_preservation" } },
      ok: false,
    });
    expect(readFileSync(server, "utf-8")).toContain("Sentry.init");
  });

  test("keeps hidden source maps and every asset glob", async () => {
    const target = path.join(directory, "nuxt.config.ts");
    const original =
      'sourcemap.client: "hidden",\nsourceMapsUploadOptions: { assets: ["dist/client/**", "dist/server/**"] },\n';
    writeFileSync(target, original);

    const hiddenResult = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [
            {
              newString: 'sourcemap.client: "false"',
              oldString: 'sourcemap.client: "hidden"',
            },
          ],
          path: "nuxt.config.ts",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );
    const assetResult = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [
            {
              newString: '["dist/client/**"]',
              oldString: '["dist/client/**", "dist/server/**"]',
            },
          ],
          path: "nuxt.config.ts",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(hiddenResult).toMatchObject({
      data: { applied: [], failed: { code: "existing_setup_preservation" } },
      ok: false,
    });
    expect(assetResult).toMatchObject({
      data: { applied: [], failed: { code: "existing_setup_preservation" } },
      ok: false,
    });
    expect(readFileSync(target, "utf-8")).toBe(original);
  });

  test("rejects whole-file replacement of a named Sentry config without language-specific markers", async () => {
    const target = path.join(directory, "sentry.config.custom");
    const original = `${"# existing configuration\n".repeat(3000)}custom_setting = true\n`;
    writeFileSync(target, original);

    const result = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [
            { newString: "custom_setting = false\n", oldString: original },
          ],
          path: "sentry.config.custom",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result).toMatchObject({
      data: { applied: [], failed: { code: "existing_setup_preservation" } },
      ok: false,
    });
    expect(readFileSync(target, "utf-8")).toBe(original);
  });

  test("does not mistake a feature in another SDK file for preserving both setups", async () => {
    const first = path.join(directory, "server.ts");
    const second = path.join(directory, "worker.ts");
    const setup =
      "Sentry.init({ dsn: process.env.SENTRY_DSN, enableLogs: true });\n";
    writeFileSync(first, setup);
    writeFileSync(second, setup);

    const result = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [{ newString: "", oldString: "enableLogs: true" }],
          path: "server.ts",
        },
        {
          action: "modify",
          edits: [
            { newString: "enableLogs: true", oldString: "enableLogs: true" },
          ],
          path: "worker.ts",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result).toMatchObject({
      data: { applied: [], failed: { code: "existing_setup_preservation" } },
      ok: false,
    });
    expect(readFileSync(first, "utf-8")).toBe(setup);
  });

  test("allows moving a configured feature between files in one prepared batch", async () => {
    const first = path.join(directory, "server.ts");
    const second = path.join(directory, "worker.ts");
    writeFileSync(
      first,
      "Sentry.init({ dsn: process.env.SENTRY_DSN, enableLogs: true });\n"
    );
    writeFileSync(second, "Sentry.init({ dsn: process.env.SENTRY_DSN });\n");

    const result = await applyPatchset(
      request(directory, [
        {
          action: "modify",
          edits: [{ newString: "", oldString: "enableLogs: true" }],
          path: "server.ts",
        },
        {
          action: "modify",
          edits: [
            {
              newString: "dsn: process.env.SENTRY_DSN, enableLogs: true",
              oldString: "dsn: process.env.SENTRY_DSN",
            },
          ],
          path: "worker.ts",
        },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(readFileSync(second, "utf-8")).toContain("enableLogs: true");
  });

  test("rejects paths that escape the project", async () => {
    const result = await applyPatchset(
      request(directory, [
        { action: "create", patch: "outside", path: "../outside.txt" },
      ]),
      { authToken: undefined, dryRun: false }
    );

    expect(result).toMatchObject({
      data: { failed: { code: "invalid_path" } },
      ok: false,
    });
  });
});
