/**
 * DSN Cache Tests
 *
 * Tests for DSN detection caching functionality.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  clearDsnCache,
  getCachedDsn,
  setCachedDsn,
  updateCachedResolution,
} from "../../../src/lib/dsn/cache.js";

// Use a unique test config directory
const TEST_CONFIG_DIR = join(homedir(), ".sentry-cli-test-cache");

describe("DSN Cache", () => {
  beforeEach(() => {
    // Set up test config directory
    process.env.SENTRY_CLI_CONFIG_DIR = TEST_CONFIG_DIR;
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test config directory
    try {
      rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("getCachedDsn", () => {
    test("returns undefined when no cache exists", async () => {
      const result = await getCachedDsn("/some/path");
      expect(result).toBeUndefined();
    });

    test("returns cached entry when it exists", async () => {
      const testDir = "/test/directory";
      await setCachedDsn(testDir, {
        dsn: "https://key@o123.ingest.sentry.io/456",
        projectId: "456",
        orgId: "123",
        source: "env_file",
        sourcePath: ".env.local",
      });

      const result = await getCachedDsn(testDir);

      expect(result).toBeDefined();
      expect(result?.dsn).toBe("https://key@o123.ingest.sentry.io/456");
      expect(result?.projectId).toBe("456");
      expect(result?.source).toBe("env_file");
      expect(result?.cachedAt).toBeDefined();
    });
  });

  describe("setCachedDsn", () => {
    test("creates new cache entry", async () => {
      const testDir = "/new/directory";

      await setCachedDsn(testDir, {
        dsn: "https://abc@o789.ingest.sentry.io/111",
        projectId: "111",
        orgId: "789",
        source: "code",
        sourcePath: "src/config.ts",
      });

      const cached = await getCachedDsn(testDir);
      expect(cached?.dsn).toBe("https://abc@o789.ingest.sentry.io/111");
      expect(cached?.sourcePath).toBe("src/config.ts");
    });

    test("updates existing cache entry", async () => {
      const testDir = "/update/test";

      await setCachedDsn(testDir, {
        dsn: "https://old@o1.ingest.sentry.io/1",
        projectId: "1",
        orgId: "1",
        source: "env_file",
      });

      await setCachedDsn(testDir, {
        dsn: "https://new@o2.ingest.sentry.io/2",
        projectId: "2",
        orgId: "2",
        source: "code",
      });

      const cached = await getCachedDsn(testDir);
      expect(cached?.dsn).toBe("https://new@o2.ingest.sentry.io/2");
      expect(cached?.projectId).toBe("2");
    });

    test("adds cachedAt timestamp", async () => {
      const testDir = "/timestamp/test";
      const before = Date.now();

      await setCachedDsn(testDir, {
        dsn: "https://key@o1.ingest.sentry.io/1",
        projectId: "1",
        source: "env",
      });

      const after = Date.now();
      const cached = await getCachedDsn(testDir);

      expect(cached?.cachedAt).toBeGreaterThanOrEqual(before);
      expect(cached?.cachedAt).toBeLessThanOrEqual(after);
    });
  });

  describe("updateCachedResolution", () => {
    test("adds resolved info to existing cache entry", async () => {
      const testDir = "/resolve/test";

      await setCachedDsn(testDir, {
        dsn: "https://key@o123.ingest.sentry.io/456",
        projectId: "456",
        orgId: "123",
        source: "env_file",
      });

      await updateCachedResolution(testDir, {
        orgSlug: "my-org",
        orgName: "My Organization",
        projectSlug: "my-project",
        projectName: "My Project",
      });

      const cached = await getCachedDsn(testDir);
      expect(cached?.resolved).toBeDefined();
      expect(cached?.resolved?.orgSlug).toBe("my-org");
      expect(cached?.resolved?.projectName).toBe("My Project");
    });

    test("does nothing when no cache entry exists", async () => {
      await updateCachedResolution("/nonexistent", {
        orgSlug: "test",
        orgName: "Test",
        projectSlug: "test",
        projectName: "Test",
      });

      const cached = await getCachedDsn("/nonexistent");
      expect(cached).toBeUndefined();
    });
  });

  describe("clearDsnCache", () => {
    test("clears specific directory cache", async () => {
      const dir1 = "/dir1";
      const dir2 = "/dir2";

      await setCachedDsn(dir1, {
        dsn: "https://a@o1.ingest.sentry.io/1",
        projectId: "1",
        source: "env",
      });
      await setCachedDsn(dir2, {
        dsn: "https://b@o2.ingest.sentry.io/2",
        projectId: "2",
        source: "env",
      });

      await clearDsnCache(dir1);

      expect(await getCachedDsn(dir1)).toBeUndefined();
      expect(await getCachedDsn(dir2)).toBeDefined();
    });

    test("clears all cache when no directory specified", async () => {
      await setCachedDsn("/dir1", {
        dsn: "https://a@o1.ingest.sentry.io/1",
        projectId: "1",
        source: "env",
      });
      await setCachedDsn("/dir2", {
        dsn: "https://b@o2.ingest.sentry.io/2",
        projectId: "2",
        source: "env",
      });

      await clearDsnCache();

      expect(await getCachedDsn("/dir1")).toBeUndefined();
      expect(await getCachedDsn("/dir2")).toBeUndefined();
    });
  });
});
