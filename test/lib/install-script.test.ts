/**
 * Install Script Tests
 *
 * Exercises the shell installer with fake download tools so argument parsing and
 * setup delegation can be validated without network access.
 */

import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

function noop(): void {
  // Intentionally empty — absorbs async spawn errors
}

const repoRoot = join(import.meta.dirname, "..", "..");
const installScript = join(repoRoot, "install");

describe("install script", () => {
  let testDir: string;
  let binDir: string;
  let argsFile: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "sentry-install-test-"));
    binDir = join(testDir, "bin");
    argsFile = join(testDir, "setup-args.txt");
    mkdirSync(binDir, { recursive: true });

    const fakeCurl = `#!/usr/bin/env bash
cat <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$SENTRY_TEST_ARGS_FILE"
SCRIPT
`;
    writeFileSync(join(binDir, "curl"), fakeCurl);
    chmodSync(join(binDir, "curl"), 0o755);

    const fakeGunzip = `#!/usr/bin/env bash
cat
`;
    writeFileSync(join(binDir, "gunzip"), fakeGunzip);
    chmodSync(join(binDir, "gunzip"), 0o755);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("passes --no-agent-skills through to sentry cli setup", async () => {
    const proc = spawn(
      "bash",
      [
        installScript,
        "--version",
        "0.31.0",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
      ],
      {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          SENTRY_TEST_ARGS_FILE: argsFile,
          TMPDIR: testDir,
        },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    proc.on("error", noop);

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d;
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d;
    });

    const exitCode = await new Promise<number>((resolve) =>
      proc.on("close", (code) => resolve(code ?? 1))
    );

    expect({ exitCode, stdout, stderr }).toMatchObject({ exitCode: 0 });
    expect(readFileSync(argsFile, "utf8").trim().split("\n")).toEqual([
      "cli",
      "setup",
      "--install",
      "--method",
      "curl",
      "--channel",
      "stable",
      "--no-modify-path",
      "--no-completions",
      "--no-agent-skills",
    ]);
  });
});
