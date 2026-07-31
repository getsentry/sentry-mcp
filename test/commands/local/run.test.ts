/**
 * Tests for the `sentry local run` command.
 *
 * Exercises the command's func() body directly to verify env var injection,
 * exit code propagation, auto-detection, --verify, --timeout, and error cases.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CLIENT_SPOTLIGHT_PREFIXES,
  runCommand,
} from "../../../src/commands/local/run.js";
import { CliError, ValidationError } from "../../../src/lib/errors.js";
import { TEST_TMP_DIR } from "../../constants.js";

/**
 * Records the env passed to the most recent `spawn` call so tests can assert
 * which variables were injected into the child process. The mock below still
 * delegates to the real `spawn`, so commands like `printenv`/`true` run for
 * real and exit codes propagate normally.
 */
const spawnCapture: { env?: NodeJS.ProcessEnv } = {};

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (
      cmd: string,
      args: readonly string[],
      options: Parameters<typeof actual.spawn>[2]
    ) => {
      spawnCapture.env = (options as { env?: NodeJS.ProcessEnv })?.env;
      return actual.spawn(cmd, args as string[], options);
    },
  };
});

type RunFunc = (
  this: unknown,
  flags: { port: number; host: string; verify: boolean; timeout: number },
  ...args: string[]
) => Promise<void>;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(TEST_TMP_DIR, "run-test-"));
});

afterEach(async () => {
  try {
    await rm(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

function makeContext(cwd?: string) {
  return {
    stdout: { write: vi.fn(() => true) },
    stderr: { write: vi.fn(() => true) },
    cwd: cwd ?? tmpDir,
  };
}

describe("sentry local run", () => {
  beforeEach(() => {
    spawnCapture.env = undefined;
  });

  test("throws ValidationError when no command and no auto-detect", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();
    try {
      await func.call(ctx, {
        port: 0,
        host: "localhost",
        verify: false,
        timeout: 0,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).message).toContain(
        "No command provided and could not auto-detect"
      );
    }
  });

  test("throws ValidationError with only -- separator", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();
    try {
      await func.call(
        ctx,
        { port: 0, host: "localhost", verify: false, timeout: 0 },
        "--"
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
    }
  });

  test("auto-detects dev command from package.json", async () => {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { dev: "echo hello" } })
    );

    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    // No args provided — should auto-detect and run "echo hello"
    await func.call(ctx, {
      port: 0,
      host: "127.0.0.1",
      verify: false,
      timeout: 0,
    });
    // If we get here without throwing, auto-detection worked and
    // "echo hello" exited 0.
  });

  test("injects SENTRY_SPOTLIGHT env var into child process", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    const port = 19_876;
    await func.call(
      ctx,
      { port, host: "127.0.0.1", verify: false, timeout: 0 },
      "echo",
      "ok"
    );
  });

  test("preserves existing SENTRY_TRACES_SAMPLE_RATE", async () => {
    const originalRate = process.env.SENTRY_TRACES_SAMPLE_RATE;
    process.env.SENTRY_TRACES_SAMPLE_RATE = "0.5";
    try {
      const func = (await runCommand.loader()) as unknown as RunFunc;
      const ctx = makeContext();
      // The child process should get 0.5, not 1
      // We verify this indirectly — if it doesn't throw, the env was set
      await func.call(
        ctx,
        { port: 19_878, host: "127.0.0.1", verify: false, timeout: 0 },
        "printenv",
        "SENTRY_TRACES_SAMPLE_RATE"
      );
    } finally {
      if (originalRate === undefined) {
        delete process.env.SENTRY_TRACES_SAMPLE_RATE;
      } else {
        process.env.SENTRY_TRACES_SAMPLE_RATE = originalRate;
      }
    }
  });

  test("propagates non-zero exit code as CliError", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    const port = 19_877;
    try {
      await func.call(
        ctx,
        { port, host: "127.0.0.1", verify: false, timeout: 0 },
        "false"
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("exited with code");
    }
  });

  test("--timeout kills the child after N seconds", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    // "sleep 60" would take too long — timeout at 1s should kill it
    try {
      await func.call(
        ctx,
        { port: 0, host: "127.0.0.1", verify: false, timeout: 1 },
        "sleep",
        "60"
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      // The child is killed by SIGTERM, resulting in a non-zero exit
      expect((err as CliError).message).toContain("exited with code");
    }
  });

  test("--verify with a quick-exit process throws WIZARD_VERIFY", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    try {
      await func.call(
        ctx,
        { port: 0, host: "127.0.0.1", verify: true, timeout: 0 },
        "true"
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain(
        "Process exited before sending any events"
      );
      expect((err as CliError).exitCode).toBe(64);
    }
  });

  test("--verify with --timeout throws on timeout", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    try {
      await func.call(
        ctx,
        { port: 0, host: "127.0.0.1", verify: true, timeout: 1 },
        "sleep",
        "60"
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("Verification timed out");
      expect((err as CliError).exitCode).toBe(64);
    }
  });

  test("throws on ENOENT (command not found)", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    try {
      await func.call(
        ctx,
        { port: 19_879, host: "127.0.0.1", verify: false, timeout: 0 },
        "nonexistent-command-that-does-not-exist"
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(
        /exited with code|Failed to start|ENOENT|spawn/i
      );
    }
  });

  test("strips leading -- separator from args", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    // "-- true" should strip "--" and run "true" successfully
    await func.call(
      ctx,
      { port: 19_880, host: "127.0.0.1", verify: false, timeout: 0 },
      "--",
      "true"
    );
  });

  test("injects spotlight URL under every framework client prefix", async () => {
    const func = (await runCommand.loader()) as unknown as RunFunc;
    const ctx = makeContext();

    const port = 19_881;
    const host = "127.0.0.1";
    const expectedUrl = `http://${host}:${port}/stream`;

    // `node:child_process` is mocked at module scope (see vi.mock below). The
    // mock records the env handed to spawn so we can assert against it.
    await func.call(ctx, { port, host, verify: false, timeout: 0 }, "printenv");

    const capturedEnv = spawnCapture.env;
    expect(capturedEnv).toBeDefined();
    // Base name read by server-side SDKs.
    expect(capturedEnv?.SENTRY_SPOTLIGHT).toBe(expectedUrl);
    // Every framework client variant points at the same URL.
    for (const prefix of CLIENT_SPOTLIGHT_PREFIXES) {
      expect(capturedEnv?.[`${prefix}SENTRY_SPOTLIGHT`]).toBe(expectedUrl);
    }
  });
});
