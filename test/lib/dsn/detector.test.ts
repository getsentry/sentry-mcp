/**
 * DSN Detector Tests (New Module)
 *
 * Tests for the new cached DSN detection with conflict detection.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { clearDsnCache, getCachedDsn } from "../../../src/lib/dsn/cache.js";
import {
  detectAllDsns,
  detectDsn,
  getDsnSourceDescription,
} from "../../../src/lib/dsn/detector.js";

// Test helpers
function createTempDir(): string {
  const dir = join(
    homedir(),
    `.sentry-cli-test-detector-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// Test config directory
const TEST_CONFIG_DIR = join(homedir(), ".sentry-cli-test-detector-config");

describe("DSN Detector (New Module)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = createTempDir();
    process.env.SENTRY_CLI_CONFIG_DIR = TEST_CONFIG_DIR;
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    // Clear any cached DSN for the test directory
    await clearDsnCache(testDir);
    // Clear SENTRY_DSN env var
    process.env.SENTRY_DSN = undefined;
  });

  afterEach(() => {
    process.env.SENTRY_DSN = undefined;
    cleanupDir(testDir);
    cleanupDir(TEST_CONFIG_DIR);
  });

  describe("detectDsn with caching", () => {
    test("caches DSN after first detection", async () => {
      const dsn = "https://key@o123.ingest.sentry.io/456";
      writeFileSync(join(testDir, ".env"), `SENTRY_DSN=${dsn}`);

      // First detection
      const result1 = await detectDsn(testDir);
      expect(result1?.raw).toBe(dsn);

      // Check cache was created
      const cached = await getCachedDsn(testDir);
      expect(cached).toBeDefined();
      expect(cached?.dsn).toBe(dsn);
      expect(cached?.source).toBe("env_file");
      expect(cached?.sourcePath).toBe(".env");

      // Second detection should use cache
      const result2 = await detectDsn(testDir);
      expect(result2?.raw).toBe(dsn);
    });

    test("updates cache when DSN changes", async () => {
      const dsn1 = "https://key1@o111.ingest.sentry.io/111";
      const dsn2 = "https://key2@o222.ingest.sentry.io/222";

      writeFileSync(join(testDir, ".env"), `SENTRY_DSN=${dsn1}`);

      // First detection
      const result1 = await detectDsn(testDir);
      expect(result1?.raw).toBe(dsn1);

      // Change DSN
      writeFileSync(join(testDir, ".env"), `SENTRY_DSN=${dsn2}`);

      // Second detection should detect change
      const result2 = await detectDsn(testDir);
      expect(result2?.raw).toBe(dsn2);

      // Cache should be updated
      const cached = await getCachedDsn(testDir);
      expect(cached?.dsn).toBe(dsn2);
    });

    test("env var takes priority over cached value", async () => {
      const envFileDsn = "https://file@o111.ingest.sentry.io/111";
      const envVarDsn = "https://var@o222.ingest.sentry.io/222";

      // Set up env file and cache it
      writeFileSync(join(testDir, ".env"), `SENTRY_DSN=${envFileDsn}`);
      await detectDsn(testDir);

      // Now set env var
      process.env.SENTRY_DSN = envVarDsn;

      // Should return env var DSN
      const result = await detectDsn(testDir);
      expect(result?.raw).toBe(envVarDsn);
      expect(result?.source).toBe("env");
    });
  });

  describe("detectAllDsns (conflict detection)", () => {
    test("detects single DSN with no conflict", async () => {
      const dsn = "https://key@o123.ingest.sentry.io/456";
      writeFileSync(join(testDir, ".env"), `SENTRY_DSN=${dsn}`);

      const result = await detectAllDsns(testDir);

      expect(result.conflict).toBe(false);
      expect(result.primary?.raw).toBe(dsn);
      expect(result.all).toHaveLength(1);
    });

    test("detects conflict with different DSNs in different files", async () => {
      const dsn1 = "https://a@o111.ingest.sentry.io/111";
      const dsn2 = "https://b@o222.ingest.sentry.io/222";

      writeFileSync(join(testDir, ".env"), `SENTRY_DSN=${dsn1}`);
      writeFileSync(join(testDir, ".env.local"), `SENTRY_DSN=${dsn2}`);

      const result = await detectAllDsns(testDir);

      expect(result.conflict).toBe(true);
      expect(result.primary).toBeNull();
      expect(result.all).toHaveLength(2);
    });

    test("no conflict when same DSN in multiple files", async () => {
      const dsn = "https://key@o123.ingest.sentry.io/456";

      writeFileSync(join(testDir, ".env"), `SENTRY_DSN=${dsn}`);
      writeFileSync(join(testDir, ".env.local"), `SENTRY_DSN=${dsn}`);

      const result = await detectAllDsns(testDir);

      expect(result.conflict).toBe(false);
      expect(result.primary?.raw).toBe(dsn);
      // Should dedupe
      expect(result.all).toHaveLength(1);
    });

    test("detects conflict between env file and code", async () => {
      const envDsn = "https://env@o111.ingest.sentry.io/111";
      const codeDsn = "https://code@o222.ingest.sentry.io/222";

      writeFileSync(join(testDir, ".env"), `SENTRY_DSN=${envDsn}`);
      mkdirSync(join(testDir, "src"), { recursive: true });
      writeFileSync(
        join(testDir, "src/config.ts"),
        `Sentry.init({ dsn: "${codeDsn}" })`
      );

      const result = await detectAllDsns(testDir);

      expect(result.conflict).toBe(true);
      expect(result.all).toHaveLength(2);
    });

    test("includes env var in conflict detection", async () => {
      const envVarDsn = "https://var@o111.ingest.sentry.io/111";
      const envFileDsn = "https://file@o222.ingest.sentry.io/222";

      process.env.SENTRY_DSN = envVarDsn;
      writeFileSync(join(testDir, ".env"), `SENTRY_DSN=${envFileDsn}`);

      const result = await detectAllDsns(testDir);

      expect(result.conflict).toBe(true);
      expect(result.all).toHaveLength(2);
      expect(result.all.map((d) => d.raw)).toContain(envVarDsn);
      expect(result.all.map((d) => d.raw)).toContain(envFileDsn);
    });
  });

  describe("getDsnSourceDescription", () => {
    test("describes env source", () => {
      const dsn = {
        raw: "https://key@o1.ingest.sentry.io/1",
        source: "env" as const,
        protocol: "https",
        publicKey: "key",
        host: "o1.ingest.sentry.io",
        projectId: "1",
        orgId: "1",
      };

      expect(getDsnSourceDescription(dsn)).toBe(
        "SENTRY_DSN environment variable"
      );
    });

    test("describes env_file source with path", () => {
      const dsn = {
        raw: "https://key@o1.ingest.sentry.io/1",
        source: "env_file" as const,
        sourcePath: ".env.local",
        protocol: "https",
        publicKey: "key",
        host: "o1.ingest.sentry.io",
        projectId: "1",
        orgId: "1",
      };

      expect(getDsnSourceDescription(dsn)).toBe(".env.local");
    });

    test("describes code source with path", () => {
      const dsn = {
        raw: "https://key@o1.ingest.sentry.io/1",
        source: "code" as const,
        sourcePath: "src/instrumentation.ts",
        protocol: "https",
        publicKey: "key",
        host: "o1.ingest.sentry.io",
        projectId: "1",
        orgId: "1",
      };

      expect(getDsnSourceDescription(dsn)).toBe("src/instrumentation.ts");
    });
  });
});
