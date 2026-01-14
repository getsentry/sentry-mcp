/**
 * Project/Org Command E2E Tests
 *
 * Tests for sentry project list and org list commands.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setAuthToken } from "../../src/lib/config.js";
import { runCli } from "../fixture.js";

// Test credentials from environment - these MUST be set
const TEST_TOKEN = process.env.SENTRY_TEST_AUTH_TOKEN;
const TEST_ORG = process.env.SENTRY_TEST_ORG;

if (!(TEST_TOKEN && TEST_ORG)) {
  throw new Error(
    "SENTRY_TEST_AUTH_TOKEN and SENTRY_TEST_ORG environment variables are required for E2E tests"
  );
}

// Each test gets its own config directory
let testConfigDir: string;
let originalConfigDir: string | undefined;

beforeEach(() => {
  originalConfigDir = process.env.SENTRY_CLI_CONFIG_DIR;
  testConfigDir = join(
    process.env.SENTRY_CLI_CONFIG_DIR || "/tmp",
    `e2e-project-${Math.random().toString(36).slice(2)}`
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

describe("sentry org list", () => {
  test("requires authentication", async () => {
    const result = await runCli(["org", "list"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("lists organizations with valid auth", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["org", "list"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.exitCode).toBe(0);
    // Should contain header and at least one org
    expect(result.stdout).toContain("SLUG");
  });

  test("supports --json output", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["org", "list", "--json"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });
});

describe("sentry project list", () => {
  test("requires authentication", async () => {
    const result = await runCli(["project", "list"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("lists projects with valid auth and org filter", async () => {
    await setAuthToken(TEST_TOKEN);

    // Use org filter to avoid timeout from listing all projects
    const result = await runCli(["project", "list", TEST_ORG, "--limit", "5"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.exitCode).toBe(0);
  });

  test("supports --json output", async () => {
    await setAuthToken(TEST_TOKEN);

    // Use org filter to avoid timeout
    const result = await runCli(
      ["project", "list", TEST_ORG, "--json", "--limit", "5"],
      {
        env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
      }
    );

    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
  });
});
