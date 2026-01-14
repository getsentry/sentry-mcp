/**
 * Auth Command E2E Tests
 *
 * Tests for sentry auth login, logout, and status commands.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setAuthToken } from "../../src/lib/config.js";
import { runCli } from "../fixture.js";

// Test credentials from environment - these MUST be set
const TEST_TOKEN = process.env.SENTRY_TEST_AUTH_TOKEN;

if (!TEST_TOKEN) {
  throw new Error(
    "SENTRY_TEST_AUTH_TOKEN environment variable is required for E2E tests"
  );
}

// Each test gets its own config directory
let testConfigDir: string;
let originalConfigDir: string | undefined;

beforeEach(() => {
  originalConfigDir = process.env.SENTRY_CLI_CONFIG_DIR;
  testConfigDir = join(
    process.env.SENTRY_CLI_CONFIG_DIR || "/tmp",
    `e2e-auth-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(testConfigDir, { recursive: true });
  process.env.SENTRY_CLI_CONFIG_DIR = testConfigDir;
});

afterEach(() => {
  try {
    rmSync(testConfigDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
  if (originalConfigDir) {
    process.env.SENTRY_CLI_CONFIG_DIR = originalConfigDir;
  }
});

describe("sentry auth status", () => {
  test("shows not authenticated when no token", async () => {
    const result = await runCli(["auth", "status"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    // Error message may be in stdout or stderr depending on CLI framework
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/not authenticated/i);
    expect(result.exitCode).toBe(1);
  });

  test("shows authenticated with valid token", async () => {
    // Set up auth token in config
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["auth", "status"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.stdout).toContain("Authenticated");
    expect(result.exitCode).toBe(0);
  });

  test("verifies credentials with valid token", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["auth", "status"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Authenticated");
    expect(result.stdout).toContain("Access verified");
  });
});

describe("sentry auth login --token", () => {
  test("stores valid API token", async () => {
    const result = await runCli(["auth", "login", "--token", TEST_TOKEN], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.stdout).toContain("Authenticated");
    expect(result.exitCode).toBe(0);

    // Verify token was stored
    const statusResult = await runCli(["auth", "status"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });
    expect(statusResult.stdout).toContain("Authenticated");
  });

  test("rejects invalid token", async () => {
    const result = await runCli(
      ["auth", "login", "--token", "invalid-token-12345"],
      {
        env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(
      /invalid|unauthorized|error/i
    );
  });
});

describe("sentry auth logout", () => {
  test("clears stored auth", async () => {
    // First login
    const loginResult = await runCli(["auth", "login", "--token", TEST_TOKEN], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });
    expect(loginResult.exitCode).toBe(0);

    // Then logout
    const result = await runCli(["auth", "logout"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/logged out/i);

    // Verify we're logged out
    const statusResult = await runCli(["auth", "status"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });
    const output = statusResult.stdout + statusResult.stderr;
    expect(output).toMatch(/not authenticated/i);
  });

  test("succeeds even when not authenticated", async () => {
    const result = await runCli(["auth", "logout"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    // Should not error, just inform user
    expect(result.exitCode).toBe(0);
  });
});
