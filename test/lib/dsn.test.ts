/**
 * DSN Parsing Tests
 *
 * Note: Core invariants (parsing, validation, round-trips, fingerprint ordering/dedup)
 * are tested via property-based tests in dsn.property.test.ts. These tests focus on
 * edge cases and self-hosted DSN behavior that property generators don't cover.
 */

import { describe, expect, test } from "vitest";
import type { DetectedDsn } from "../../src/lib/dsn/index.js";
import {
  createDetectedDsn,
  createDsnFingerprint,
  inferPackagePath,
  parseDsn,
} from "../../src/lib/dsn/index.js";

describe("parseDsn edge cases", () => {
  test("returns null for DSN without project ID (trailing slash)", () => {
    const dsn = "https://key@o123.ingest.sentry.io/";
    const result = parseDsn(dsn);
    expect(result).toBeNull();
  });

  test("handles DSN with path segments", () => {
    const dsn = "https://key@o123.ingest.sentry.io/api/456";
    const result = parseDsn(dsn);
    expect(result?.projectId).toBe("456");
  });
});

describe("createDsnFingerprint: self-hosted DSNs", () => {
  test("includes DSNs without orgId using host as prefix", () => {
    const saas: DetectedDsn = {
      raw: "https://key@o123.ingest.sentry.io/456",
      protocol: "https",
      publicKey: "key",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
      source: "env",
    };
    const selfHosted: DetectedDsn = {
      raw: "https://key@sentry.mycompany.com/1",
      protocol: "https",
      publicKey: "key",
      host: "sentry.mycompany.com",
      projectId: "1",
      orgId: undefined,
      source: "env",
    };

    const result = createDsnFingerprint([saas, selfHosted]);
    expect(result).toBe("123:456,sentry.mycompany.com:1");
  });

  test("returns host-based fingerprint for self-hosted DSNs", () => {
    const selfHosted: DetectedDsn = {
      raw: "https://key@sentry.mycompany.com/1",
      protocol: "https",
      publicKey: "key",
      host: "sentry.mycompany.com",
      projectId: "1",
      orgId: undefined,
      source: "env",
    };

    const result = createDsnFingerprint([selfHosted]);
    expect(result).toBe("sentry.mycompany.com:1");
  });
});

describe("createDetectedDsn edge cases", () => {
  test("includes packagePath when provided", () => {
    const result = createDetectedDsn(
      "https://abc123@o123.ingest.sentry.io/456",
      "code",
      "packages/web/src/config.ts",
      "packages/web"
    );
    expect(result?.packagePath).toBe("packages/web");
  });
});

describe("inferPackagePath", () => {
  test("infers package path from packages/ directory", () => {
    expect(inferPackagePath("packages/frontend/src/index.ts")).toBe(
      "packages/frontend"
    );
  });

  test("infers package path from apps/ directory", () => {
    expect(inferPackagePath("apps/web/.env")).toBe("apps/web");
  });

  test("infers package path from services/ directory", () => {
    expect(inferPackagePath("services/api/server.ts")).toBe("services/api");
  });

  test("infers package path from modules/ directory", () => {
    // Property generator only uses packages/apps/services/libs — modules/ is not covered
    expect(inferPackagePath("modules/auth/index.ts")).toBe("modules/auth");
  });

  test("returns undefined for non-monorepo directories", () => {
    expect(inferPackagePath("other/path/file.ts")).toBeUndefined();
  });
});
