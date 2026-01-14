/**
 * Test Fixtures and Helpers
 *
 * Shared utilities for creating isolated test environments.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Create a temporary directory for testing
 *
 * @param options - Configuration for the temp directory
 * @returns Disposable temp directory object
 */
export async function tmpdir(options?: {
  files?: Record<string, string>;
  env?: Record<string, string>;
}) {
  const dir = join(
    homedir(),
    `.sentry-cli-test-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });

  // Create files if specified
  if (options?.files) {
    for (const [filepath, content] of Object.entries(options.files)) {
      const fullPath = join(dir, filepath);
      const dirPath = fullPath.slice(0, fullPath.lastIndexOf("/"));
      if (dirPath && dirPath !== dir) {
        mkdirSync(dirPath, { recursive: true });
      }
      writeFileSync(fullPath, content);
    }
  }

  // Create .env file if specified
  if (options?.env) {
    const envContent = Object.entries(options.env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    writeFileSync(join(dir, ".env"), envContent);
  }

  return {
    path: dir,
    [Symbol.asyncDispose]: async () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Mock process for capturing CLI output
 */
export function mockProcess() {
  const output = { stdout: "", stderr: "", exitCode: 0 };

  return {
    output,
    process: {
      stdout: {
        write: (s: string) => {
          output.stdout += s;
        },
      },
      stderr: {
        write: (s: string) => {
          output.stderr += s;
        },
      },
      get exitCode() {
        return output.exitCode;
      },
      set exitCode(code: number) {
        output.exitCode = code;
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Runner
// ─────────────────────────────────────────────────────────────────────────────

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run CLI command and capture output
 *
 * @param args - CLI arguments (e.g., ["auth", "status"])
 * @param options - Optional cwd and env overrides
 * @returns Captured stdout, stderr, and exit code
 *
 * @example
 * const result = await runCli(["auth", "status"]);
 * expect(result.exitCode).toBe(0);
 */
export async function runCli(
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
  }
): Promise<CliResult> {
  const cliDir = join(import.meta.dir, "..");

  const proc = Bun.spawn(["bun", "run", "src/bin.ts", ...args], {
    cwd: options?.cwd ?? cliDir,
    env: { ...process.env, ...options?.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return {
    stdout,
    stderr,
    exitCode: await proc.exited,
  };
}
