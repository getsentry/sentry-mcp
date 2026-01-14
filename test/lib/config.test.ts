/**
 * Configuration Management Tests
 *
 * Integration tests for config file read/write operations.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  clearAuth,
  getAuthToken,
  getDefaultOrganization,
  getDefaultProject,
  isAuthenticated,
  readConfig,
  setAuthToken,
  setDefaults,
  writeConfig,
} from "../../src/lib/config.js";

// Each test gets its own config directory
let testConfigDir: string;

beforeEach(() => {
  testConfigDir = join(
    process.env.SENTRY_CLI_CONFIG_DIR!,
    `test-${Math.random().toString(36).slice(2)}`
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
});

describe("readConfig", () => {
  test("returns empty object when no config file exists", async () => {
    const config = await readConfig();
    expect(config).toEqual({});
  });

  test("reads existing config file", async () => {
    const configPath = join(testConfigDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        auth: { token: "test-token" },
        defaults: { organization: "test-org" },
      })
    );

    const config = await readConfig();
    expect(config.auth?.token).toBe("test-token");
    expect(config.defaults?.organization).toBe("test-org");
  });

  test("returns empty object for invalid JSON", async () => {
    const configPath = join(testConfigDir, "config.json");
    writeFileSync(configPath, "not valid json {{{");

    const config = await readConfig();
    expect(config).toEqual({});
  });

  test("returns empty object for invalid schema", async () => {
    const configPath = join(testConfigDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        auth: { token: 12_345 }, // token should be string
      })
    );

    const config = await readConfig();
    expect(config).toEqual({});
  });
});

describe("writeConfig", () => {
  test("writes config file", async () => {
    await writeConfig({
      auth: { token: "my-token" },
    });

    const config = await readConfig();
    expect(config.auth?.token).toBe("my-token");
  });

  test("overwrites existing config", async () => {
    await writeConfig({ auth: { token: "first" } });
    await writeConfig({ auth: { token: "second" } });

    const config = await readConfig();
    expect(config.auth?.token).toBe("second");
  });
});

describe("auth token management", () => {
  test("setAuthToken stores token", async () => {
    await setAuthToken("test-token-123");

    const token = await getAuthToken();
    expect(token).toBe("test-token-123");
  });

  test("setAuthToken with expiration sets expiresAt", async () => {
    const before = Date.now();
    await setAuthToken("expiring-token", 3600); // 1 hour
    const after = Date.now();

    const config = await readConfig();
    expect(config.auth?.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(config.auth?.expiresAt).toBeLessThanOrEqual(after + 3600 * 1000);
  });

  test("setAuthToken stores refresh token", async () => {
    await setAuthToken("access-token", 3600, "refresh-token");

    const config = await readConfig();
    expect(config.auth?.refreshToken).toBe("refresh-token");
  });

  test("getAuthToken returns undefined for expired token", async () => {
    // Set a token that expired 1 second ago
    await writeConfig({
      auth: {
        token: "expired-token",
        expiresAt: Date.now() - 1000,
      },
    });

    const token = await getAuthToken();
    expect(token).toBeUndefined();
  });

  test("getAuthToken returns token if not expired", async () => {
    // Set a token that expires in 1 hour
    await writeConfig({
      auth: {
        token: "valid-token",
        expiresAt: Date.now() + 3600 * 1000,
      },
    });

    const token = await getAuthToken();
    expect(token).toBe("valid-token");
  });

  test("clearAuth removes auth data", async () => {
    await setAuthToken("token-to-clear");
    expect(await getAuthToken()).toBe("token-to-clear");

    await clearAuth();
    expect(await getAuthToken()).toBeUndefined();
  });

  test("isAuthenticated returns true with valid token", async () => {
    await setAuthToken("valid-token");
    expect(await isAuthenticated()).toBe(true);
  });

  test("isAuthenticated returns false without token", async () => {
    expect(await isAuthenticated()).toBe(false);
  });

  test("isAuthenticated returns false with expired token", async () => {
    await writeConfig({
      auth: {
        token: "expired",
        expiresAt: Date.now() - 1000,
      },
    });

    expect(await isAuthenticated()).toBe(false);
  });
});

describe("defaults management", () => {
  test("setDefaults stores organization", async () => {
    await setDefaults("my-org");

    const org = await getDefaultOrganization();
    expect(org).toBe("my-org");
  });

  test("setDefaults stores project", async () => {
    await setDefaults(undefined, "my-project");

    const project = await getDefaultProject();
    expect(project).toBe("my-project");
  });

  test("setDefaults stores both org and project", async () => {
    await setDefaults("my-org", "my-project");

    expect(await getDefaultOrganization()).toBe("my-org");
    expect(await getDefaultProject()).toBe("my-project");
  });

  test("setDefaults preserves existing defaults", async () => {
    await setDefaults("org1", "project1");
    await setDefaults("org2"); // Only update org

    expect(await getDefaultOrganization()).toBe("org2");
    expect(await getDefaultProject()).toBe("project1");
  });

  test("getDefaultOrganization returns undefined when not set", async () => {
    const org = await getDefaultOrganization();
    expect(org).toBeUndefined();
  });

  test("getDefaultProject returns undefined when not set", async () => {
    const project = await getDefaultProject();
    expect(project).toBeUndefined();
  });
});
