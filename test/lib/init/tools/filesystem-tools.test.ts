import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as dsnIndex from "../../../../src/lib/dsn/index.js";
import { executeTool } from "../../../../src/lib/init/tools/registry.js";
import type {
  ResolvedInitContext,
  ToolPayload,
} from "../../../../src/lib/init/types.js";
import { precomputeDirListing } from "../../../../src/lib/init/workflow-inputs.js";

function makeContext(directory: string): ResolvedInitContext {
  return {
    directory,
    yes: true,
    dryRun: false,
    org: "acme",
    team: "platform",
    authToken: "sntrys_test_token_123",
  };
}

let testDir: string;
let detectDsnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join("/tmp", "init-tools-"));
  detectDsnSpy = vi.spyOn(dsnIndex, "detectDsn").mockResolvedValue(null);
});

afterEach(() => {
  detectDsnSpy.mockRestore();
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("filesystem tools", () => {
  test("rejects tool execution when cwd escapes the project directory", async () => {
    const payload = {
      type: "tool",
      operation: "list-dir",
      cwd: "/",
      params: { path: "." },
    } as ToolPayload;

    const result = await executeTool(payload, makeContext(testDir));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside project directory");
  });

  test("lists and precomputes directory contents", async () => {
    fs.writeFileSync(path.join(testDir, "index.ts"), "export {};\n");
    fs.mkdirSync(path.join(testDir, "src"));
    fs.writeFileSync(
      path.join(testDir, "src", "app.ts"),
      "console.log('x');\n"
    );

    const result = await executeTool(
      {
        type: "tool",
        operation: "list-dir",
        cwd: testDir,
        params: { path: ".", recursive: true, maxDepth: 3 },
      },
      makeContext(testDir)
    );
    const entries = (result.data as { entries: Array<{ path: string }> })
      .entries;
    const precomputed = await precomputeDirListing(testDir);

    expect(result.ok).toBe(true);
    expect(entries.map((entry) => entry.path)).toContain("src/app.ts");
    expect(precomputed.map((entry) => entry.path)).toContain("src/app.ts");
  });

  test("reads files and checks existence in batches", async () => {
    fs.writeFileSync(path.join(testDir, "exists.txt"), "hello");

    const readResult = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: { paths: ["exists.txt", "missing.txt"] },
      },
      makeContext(testDir)
    );
    const existsResult = await executeTool(
      {
        type: "tool",
        operation: "file-exists-batch",
        cwd: testDir,
        params: { paths: ["exists.txt", "missing.txt"] },
      },
      makeContext(testDir)
    );

    expect((readResult.data as any).files["exists.txt"]).toBe("hello");
    expect((readResult.data as any).files["missing.txt"]).toBeNull();
    expect((existsResult.data as any).exists["exists.txt"]).toBe(true);
    expect((existsResult.data as any).exists["missing.txt"]).toBe(false);
  });

  test("returns independent bounded V2 line ranges", async () => {
    fs.writeFileSync(
      path.join(testDir, "large.txt"),
      Array.from({ length: 8 }, (_, index) => `line-${index + 1}`).join("\n")
    );

    const first = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: {
          maxLines: 3,
          paths: ["large.txt"],
          resultVersion: 2,
        },
      },
      makeContext(testDir)
    );
    const later = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: {
          maxLines: 2,
          paths: ["large.txt"],
          resultVersion: 2,
          startLine: 5,
        },
      },
      makeContext(testDir)
    );

    expect(first.data).toEqual({
      files: {
        "large.txt": {
          content: "line-1\nline-2\nline-3\n",
          status: "ok",
          truncated: true,
        },
      },
      version: 2,
    });
    expect(later.data).toEqual({
      files: {
        "large.txt": {
          content: "line-5\nline-6\n",
          status: "ok",
          truncated: true,
        },
      },
      version: 2,
    });
  });

  test("preserves exact line endings in V2 snapshots", async () => {
    fs.writeFileSync(path.join(testDir, "windows.txt"), "first\r\nsecond\r\n");

    const result = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: {
          maxLines: 1,
          paths: ["windows.txt"],
          resultVersion: 2,
        },
      },
      makeContext(testDir)
    );

    expect(result.data).toEqual({
      files: {
        "windows.txt": {
          content: "first\r\n",
          status: "ok",
          truncated: true,
        },
      },
      version: 2,
    });
  });

  test("rejects malformed V2 read requests before local I/O", async () => {
    const result = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: undefined,
      } as unknown as ToolPayload,
      makeContext(testDir)
    );

    expect(result).toEqual({
      error: "read-files params must be an object",
      ok: false,
    });
  });

  test("keeps read-files bounds and sensitive-path policy local", async () => {
    fs.writeFileSync(path.join(testDir, ".env.local"), "SECRET=value\n");
    fs.writeFileSync(path.join(testDir, ".pypirc"), "token=secret\n");
    fs.writeFileSync(path.join(testDir, "binary.txt"), Buffer.from([0, 1, 2]));
    fs.symlinkSync(".env.local", path.join(testDir, "config.txt"));

    const sensitive = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: { paths: [".env.local"], resultVersion: 2 },
      },
      makeContext(testDir)
    );
    const binary = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: { paths: ["binary.txt"], resultVersion: 2 },
      },
      makeContext(testDir)
    );
    const omittedSensitive = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: { paths: [".pypirc"], resultVersion: 2 },
      },
      makeContext(testDir)
    );
    const sensitiveAlias = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: { paths: ["config.txt"], resultVersion: 2 },
      },
      makeContext(testDir)
    );

    expect(sensitive.data).toEqual({
      files: { ".env.local": { error: "unreadable", status: "error" } },
      version: 2,
    });
    expect(omittedSensitive.data).toEqual({
      files: { ".pypirc": { error: "unreadable", status: "error" } },
      version: 2,
    });
    expect(binary.data).toEqual({
      files: { "binary.txt": { error: "not-text", status: "error" } },
      version: 2,
    });
    expect(sensitiveAlias.data).toEqual({
      files: { "config.txt": { error: "unreadable", status: "error" } },
      version: 2,
    });
  });

  test("finds later lines without exposing a cursor protocol", async () => {
    fs.writeFileSync(
      path.join(testDir, "deep.txt"),
      `${"x".repeat(270_000)}\ntarget\n`
    );

    const result = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: {
          maxLines: 1,
          paths: ["deep.txt"],
          resultVersion: 2,
          startLine: 2,
        },
      },
      makeContext(testDir)
    );

    expect(result.data).toEqual({
      files: {
        "deep.txt": {
          content: "target\n",
          status: "ok",
          truncated: false,
        },
      },
      version: 2,
    });
  });

  test("bounds V2 content across a multi-file request", async () => {
    const paths = Array.from({ length: 20 }, (_, index) => `file-${index}.txt`);
    for (const filePath of paths) {
      fs.writeFileSync(path.join(testDir, filePath), "x\n".repeat(5000));
    }

    const result = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: { maxBytes: 40_000, paths, resultVersion: 2 },
      },
      makeContext(testDir)
    );
    const files = (
      result.data as { files: Record<string, { content: string }> }
    ).files;

    expect(result.ok).toBe(true);
    expect(
      Object.values(files).reduce(
        (total, file) => total + Buffer.byteLength(file.content),
        0
      )
    ).toBeLessThanOrEqual(40_000);
  });

  test("reads a short line that starts at the deep-scan boundary", async () => {
    const scanBytes = 4 * 1024 * 1024;
    const prefix = "x\n".repeat(scanBytes / 2);
    fs.writeFileSync(path.join(testDir, "boundary.txt"), `${prefix}target\n`);

    const result = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: {
          maxLines: 1,
          paths: ["boundary.txt"],
          resultVersion: 2,
          startLine: scanBytes / 2 + 1,
        },
      },
      makeContext(testDir)
    );

    expect(result.data).toEqual({
      files: {
        "boundary.txt": {
          content: "target\n",
          status: "ok",
          truncated: false,
        },
      },
      version: 2,
    });
  });

  test("reports an existing line beyond the deep-scan boundary", async () => {
    const scanBytes = 4 * 1024 * 1024;
    const prefix = `${"x".repeat(scanBytes)}\n`;
    fs.writeFileSync(path.join(testDir, "too-deep.txt"), `${prefix}target\n`);

    const result = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: {
          maxLines: 1,
          paths: ["too-deep.txt"],
          resultVersion: 2,
          startLine: 2,
        },
      },
      makeContext(testDir)
    );

    expect(result.data).toEqual({
      files: {
        "too-deep.txt": { error: "range-too-deep", status: "error" },
      },
      version: 2,
    });
  });

  test("rejects incomplete lines and invalid UTF-8 instead of clipping", async () => {
    fs.writeFileSync(
      path.join(testDir, "long-line.txt"),
      `${"x".repeat(50_000)}\n`
    );
    fs.writeFileSync(
      path.join(testDir, "invalid-utf8.txt"),
      Buffer.from([0x61, 0x62, 0x63, 0xff])
    );
    fs.writeFileSync(path.join(testDir, "multibyte.txt"), "é\n");

    const read = (filePath: string, maxBytes?: number) =>
      executeTool(
        {
          type: "tool",
          operation: "read-files",
          cwd: testDir,
          params: {
            maxBytes,
            paths: [filePath],
            resultVersion: 2,
          },
        },
        makeContext(testDir)
      );

    expect((await read("long-line.txt")).data).toEqual({
      files: {
        "long-line.txt": { error: "line-too-long", status: "error" },
      },
      version: 2,
    });
    expect((await read("invalid-utf8.txt")).data).toEqual({
      files: {
        "invalid-utf8.txt": { error: "not-text", status: "error" },
      },
      version: 2,
    });
    expect((await read("multibyte.txt", 1)).data).toEqual({
      files: {
        "multibyte.txt": { error: "line-too-long", status: "error" },
      },
      version: 2,
    });
  });

  test("preserves not-file when descriptor cleanup fails", async () => {
    const close = vi.fn().mockRejectedValue(new Error("close failed"));
    const open = vi.spyOn(fs.promises, "open").mockResolvedValue({
      close,
      stat: vi.fn().mockResolvedValue({ isFile: () => false }),
    } as unknown as fs.promises.FileHandle);

    try {
      const result = await executeTool(
        {
          type: "tool",
          operation: "read-files",
          cwd: testDir,
          params: { paths: ["directory"], resultVersion: 2 },
        },
        makeContext(testDir)
      );

      expect(result.data).toEqual({
        files: { directory: { error: "not-file", status: "error" } },
        version: 2,
      });
      expect(close).toHaveBeenCalledOnce();
    } finally {
      open.mockRestore();
    }
  });

  test("applies patchsets and injects auth tokens into env files", async () => {
    const result = await executeTool(
      {
        type: "tool",
        operation: "apply-patchset",
        cwd: testDir,
        params: {
          patches: [
            {
              path: ".env.sentry-build-plugin",
              action: "create",
              patch: "SENTRY_AUTH_TOKEN=\n",
            },
          ],
        },
      },
      makeContext(testDir)
    );

    expect(result.ok).toBe(true);
    expect(
      fs.readFileSync(path.join(testDir, ".env.sentry-build-plugin"), "utf-8")
    ).toContain("sntrys_test_token_123");
  });

  test("rejects unsafe apply-patchset paths before writing", async () => {
    const unsafePaths: unknown[] = [
      null,
      "../../outside.txt",
      "/tmp/outside.txt",
      "C:/repo/package.json",
      "C:\\repo\\package.json",
      "apps/../package.json",
      "./package.json",
      "apps//package.json",
    ];

    for (const unsafePath of unsafePaths) {
      const result = await executeTool(
        {
          type: "tool",
          operation: "apply-patchset",
          cwd: testDir,
          params: {
            patches: [
              {
                path: unsafePath as never,
                action: "create",
                patch: "should not be written\n",
              },
            ],
          },
        },
        makeContext(testDir)
      );

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(
        /Invalid (?:file change path|file changes request)/
      );
    }
  });

  test("applies patchsets to nested project-relative files", async () => {
    fs.mkdirSync(path.join(testDir, "Cary.ConversionFunnels.API"));
    fs.writeFileSync(
      path.join(
        testDir,
        "Cary.ConversionFunnels.API",
        "Cary.ConversionFunnels.API.csproj"
      ),
      "<Project></Project>\n"
    );

    const result = await executeTool(
      {
        type: "tool",
        operation: "apply-patchset",
        cwd: testDir,
        params: {
          patches: [
            {
              path: "Directory.Packages.props",
              action: "create",
              patch: "<Project></Project>\n",
            },
            {
              path: "Cary.ConversionFunnels.API/Cary.ConversionFunnels.API.csproj",
              action: "modify",
              edits: [
                {
                  oldString: "<Project></Project>",
                  newString:
                    '<Project><ItemGroup><PackageReference Include="Sentry.AspNetCore" /></ItemGroup></Project>',
                },
              ],
            },
          ],
        },
      },
      makeContext(testDir)
    );

    expect(result.ok).toBe(true);
    expect(
      fs.readFileSync(path.join(testDir, "Directory.Packages.props"), "utf-8")
    ).toContain("<Project>");
    expect(
      fs.readFileSync(
        path.join(
          testDir,
          "Cary.ConversionFunnels.API",
          "Cary.ConversionFunnels.API.csproj"
        ),
        "utf-8"
      )
    ).toContain("Sentry.AspNetCore");
  });

  test("greps and globs files inside the project", async () => {
    fs.mkdirSync(path.join(testDir, "src"));
    fs.writeFileSync(
      path.join(testDir, "src", "app.ts"),
      "Sentry.captureException(error);\n"
    );

    const grepResult = await executeTool(
      {
        type: "tool",
        operation: "grep",
        cwd: testDir,
        params: { searches: [{ pattern: "captureException" }] },
      },
      makeContext(testDir)
    );
    const globResult = await executeTool(
      {
        type: "tool",
        operation: "glob",
        cwd: testDir,
        params: { patterns: ["**/*.ts"] },
      },
      makeContext(testDir)
    );

    expect((grepResult.data as any).results[0].matches[0].path).toBe(
      "src/app.ts"
    );
    expect((globResult.data as any).results[0].files).toContain("src/app.ts");
  });

  test("reports installed Sentry signals when a DSN is detected", async () => {
    detectDsnSpy.mockResolvedValue({
      publicKey: "abc",
      protocol: "https",
      host: "o1.ingest.sentry.io",
      projectId: "42",
      raw: "https://abc@o1.ingest.sentry.io/42",
      source: "env_file" as const,
      sourcePath: ".env",
    });

    const result = await executeTool(
      {
        type: "tool",
        operation: "detect-sentry",
        cwd: testDir,
        params: {},
      },
      makeContext(testDir)
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        status: "installed",
        dsn: "https://abc@o1.ingest.sentry.io/42",
      })
    );
  });
});
