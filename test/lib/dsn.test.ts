/**
 * DSN Parsing Tests
 *
 * Unit tests for DSN parsing and validation logic.
 */

import { describe, expect, test } from "bun:test";
import {
  extractOrgIdFromHost,
  isValidDsn,
  parseDsn,
} from "../../src/lib/dsn.js";

describe("extractOrgIdFromHost", () => {
  test("extracts org ID from US ingest host", () => {
    const result = extractOrgIdFromHost("o1169445.ingest.us.sentry.io");
    expect(result).toBe("1169445");
  });

  test("extracts org ID from EU ingest host", () => {
    const result = extractOrgIdFromHost("o123.ingest.de.sentry.io");
    expect(result).toBe("123");
  });

  test("extracts org ID from default ingest host", () => {
    const result = extractOrgIdFromHost("o999.ingest.sentry.io");
    expect(result).toBe("999");
  });

  test("returns null for self-hosted host", () => {
    const result = extractOrgIdFromHost("sentry.mycompany.com");
    expect(result).toBeNull();
  });

  test("returns null for non-Sentry host", () => {
    const result = extractOrgIdFromHost("example.com");
    expect(result).toBeNull();
  });
});

describe("parseDsn", () => {
  test("parses valid SaaS DSN with org ID", () => {
    const dsn = "https://abc123@o1169445.ingest.us.sentry.io/4505229541441536";
    const result = parseDsn(dsn);

    expect(result).toEqual({
      protocol: "https",
      publicKey: "abc123",
      host: "o1169445.ingest.us.sentry.io",
      projectId: "4505229541441536",
      orgId: "1169445",
    });
  });

  test("parses valid self-hosted DSN without org ID", () => {
    const dsn = "https://abc123@sentry.mycompany.com/1";
    const result = parseDsn(dsn);

    expect(result).toEqual({
      protocol: "https",
      publicKey: "abc123",
      host: "sentry.mycompany.com",
      projectId: "1",
      orgId: undefined,
    });
  });

  test("parses DSN with http protocol", () => {
    const dsn = "http://key@o123.ingest.sentry.io/456";
    const result = parseDsn(dsn);

    expect(result).toEqual({
      protocol: "http",
      publicKey: "key",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
    });
  });

  test("returns null for DSN without public key", () => {
    const dsn = "https://sentry.io/123";
    const result = parseDsn(dsn);
    expect(result).toBeNull();
  });

  test("returns null for DSN without project ID", () => {
    const dsn = "https://key@o123.ingest.sentry.io/";
    const result = parseDsn(dsn);
    expect(result).toBeNull();
  });

  test("returns null for invalid URL", () => {
    const dsn = "not-a-url";
    const result = parseDsn(dsn);
    expect(result).toBeNull();
  });

  test("returns null for empty string", () => {
    const result = parseDsn("");
    expect(result).toBeNull();
  });

  test("handles DSN with path segments", () => {
    const dsn = "https://key@o123.ingest.sentry.io/api/456";
    const result = parseDsn(dsn);

    expect(result?.projectId).toBe("456");
  });
});

describe("isValidDsn", () => {
  test("returns true for valid SaaS DSN", () => {
    const dsn = "https://abc123@o1169445.ingest.us.sentry.io/4505229541441536";
    expect(isValidDsn(dsn)).toBe(true);
  });

  test("returns true for valid self-hosted DSN", () => {
    const dsn = "https://abc123@sentry.mycompany.com/1";
    expect(isValidDsn(dsn)).toBe(true);
  });

  test("returns false for invalid DSN", () => {
    const dsn = "https://sentry.io/123";
    expect(isValidDsn(dsn)).toBe(false);
  });

  test("returns false for non-URL string", () => {
    const dsn = "not-a-url";
    expect(isValidDsn(dsn)).toBe(false);
  });
});
