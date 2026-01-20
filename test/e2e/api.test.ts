/**
 * API Command E2E Tests
 *
 * Tests for sentry api command - raw authenticated API requests.
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
    `e2e-api-${Math.random().toString(36).slice(2)}`
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

describe("sentry api", () => {
  // Note: The API client's base URL already includes /api/0/, so endpoints
  // should NOT include that prefix (e.g., use "organizations/" not "/api/0/organizations/")

  test("requires authentication", async () => {
    const result = await runCli(["api", "organizations/"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("GET request works with valid auth", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["api", "organizations/"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.exitCode).toBe(0);
    // Should return JSON array of organizations
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  test("--include flag shows response headers", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["api", "organizations/", "--include"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.exitCode).toBe(0);
    // Should include HTTP status and headers before JSON body
    expect(result.stdout).toMatch(/^HTTP \d{3}/);
    expect(result.stdout).toMatch(/content-type:/i);
  });

  test("invalid endpoint returns non-zero exit code", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["api", "nonexistent-endpoint-12345/"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.exitCode).toBe(1);
  });

  test("--silent flag suppresses output", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["api", "organizations/", "--silent"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  test("--silent with error sets exit code but no output", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(
      ["api", "nonexistent-endpoint-12345/", "--silent"],
      {
        env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });

  test("supports custom HTTP method", async () => {
    await setAuthToken(TEST_TOKEN);

    // DELETE on organizations list should return 405 Method Not Allowed
    const result = await runCli(
      ["api", "organizations/", "--method", "DELETE"],
      {
        env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
      }
    );

    // Method not allowed or similar error - just checking it processes the flag
    expect(result.exitCode).toBe(1);
  });

  test("rejects invalid HTTP method", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(
      ["api", "organizations/", "--method", "INVALID"],
      {
        env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
      }
    );

    // Exit code 252 is stricli's parse error code, 1 is a general error
    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.stderr + result.stdout).toMatch(/invalid method/i);
  });
});
