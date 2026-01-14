/**
 * Issue Command E2E Tests
 *
 * Tests for sentry issue list and get commands.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setAuthToken } from "../../src/lib/config.js";
import { runCli } from "../fixture.js";

// Test credentials from environment - these MUST be set
const TEST_TOKEN = process.env.SENTRY_TEST_AUTH_TOKEN;
const TEST_ORG = process.env.SENTRY_TEST_ORG;
const TEST_PROJECT = process.env.SENTRY_TEST_PROJECT;

if (!(TEST_TOKEN && TEST_ORG && TEST_PROJECT)) {
  throw new Error(
    "SENTRY_TEST_AUTH_TOKEN, SENTRY_TEST_ORG, and SENTRY_TEST_PROJECT environment variables are required for E2E tests"
  );
}

// Each test gets its own config directory
let testConfigDir: string;
let originalConfigDir: string | undefined;

beforeEach(() => {
  originalConfigDir = process.env.SENTRY_CLI_CONFIG_DIR;
  testConfigDir = join(
    process.env.SENTRY_CLI_CONFIG_DIR || "/tmp",
    `e2e-issue-${Math.random().toString(36).slice(2)}`
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

describe("sentry issue list", () => {
  test("requires authentication", async () => {
    const result = await runCli(
      ["issue", "list", "--org", "test-org", "--project", "test-project"],
      {
        env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("lists issues with valid auth", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(
      ["issue", "list", "--org", TEST_ORG, "--project", TEST_PROJECT],
      {
        env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
      }
    );

    // Should succeed (may have 0 issues, that's fine)
    expect(result.exitCode).toBe(0);
  });

  test("supports --json output", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(
      ["issue", "list", "--org", TEST_ORG, "--project", TEST_PROJECT, "--json"],
      {
        env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
      }
    );

    expect(result.exitCode).toBe(0);
    // Should be valid JSON array
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("sentry issue get", () => {
  test("requires authentication", async () => {
    const result = await runCli(["issue", "get", "12345"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("handles non-existent issue", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["issue", "get", "99999999999"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not found|error/i);
  });
});
