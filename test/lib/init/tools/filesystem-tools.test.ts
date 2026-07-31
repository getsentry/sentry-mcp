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
      expect(result.error).toContain("Invalid patch path");
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
