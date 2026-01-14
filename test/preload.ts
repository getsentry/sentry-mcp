/**
 * Test Environment Setup
 *
 * Isolates tests from user's real configuration and environment.
 * Runs before all tests via bunfig.toml preload.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Load .env.local for test credentials (SENTRY_TEST_*)
// This mimics what would happen in CI where secrets are injected as env vars
const envLocalPath = resolve(import.meta.dir, "../../../.env.local");
if (existsSync(envLocalPath)) {
  const content = readFileSync(envLocalPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Only set if not already set (env vars take precedence)
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// Create isolated test directory
const testDir = join(homedir(), `.sentry-cli-test-${process.pid}`);
mkdirSync(testDir, { recursive: true });

// Override config directory for all tests
process.env.SENTRY_CLI_CONFIG_DIR = testDir;

// Clear Sentry environment variables to ensure clean state
// (but preserve SENTRY_TEST_* vars for E2E tests)
delete process.env.SENTRY_DSN;
delete process.env.SENTRY_AUTH_TOKEN;
delete process.env.SENTRY_CLIENT_ID;
delete process.env.SENTRY_URL;

// Cleanup after all tests
process.on("exit", () => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// Also cleanup on SIGINT/SIGTERM
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
