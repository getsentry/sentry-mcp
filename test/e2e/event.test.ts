/**
 * Event Command E2E Tests
 *
 * Tests for sentry event get command.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setAuthToken } from "../../src/lib/config.js";
import { runCli } from "../fixture.js";

const TEST_TOKEN = process.env.SENTRY_TEST_AUTH_TOKEN;
const TEST_ORG = process.env.SENTRY_TEST_ORG;
const TEST_PROJECT = process.env.SENTRY_TEST_PROJECT;

if (!(TEST_TOKEN && TEST_ORG && TEST_PROJECT)) {
  throw new Error(
    "SENTRY_TEST_AUTH_TOKEN, SENTRY_TEST_ORG, and SENTRY_TEST_PROJECT environment variables are required for E2E tests"
  );
}

let testConfigDir: string;
let originalConfigDir: string | undefined;

beforeEach(() => {
  originalConfigDir = process.env.SENTRY_CLI_CONFIG_DIR;
  testConfigDir = join(
    process.env.SENTRY_CLI_CONFIG_DIR || "/tmp",
    `e2e-event-${Math.random().toString(36).slice(2)}`
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
  } else {
    delete process.env.SENTRY_CLI_CONFIG_DIR;
  }
});

describe("sentry event get", () => {
  test("requires authentication", async () => {
    const result = await runCli(
      ["event", "get", "abc123", "--org", TEST_ORG, "--project", TEST_PROJECT],
      { env: { SENTRY_CLI_CONFIG_DIR: testConfigDir } }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not authenticated|login/i);
  });

  test("requires org and project without DSN", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(["event", "get", "abc123"], {
      env: { SENTRY_CLI_CONFIG_DIR: testConfigDir },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/organization|project/i);
  });

  test("handles non-existent event", async () => {
    await setAuthToken(TEST_TOKEN);

    const result = await runCli(
      [
        "event",
        "get",
        "nonexistent123",
        "--org",
        TEST_ORG,
        "--project",
        TEST_PROJECT,
      ],
      { env: { SENTRY_CLI_CONFIG_DIR: testConfigDir } }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not found|error|404/i);
  });
});
