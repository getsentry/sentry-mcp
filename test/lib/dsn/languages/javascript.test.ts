/**
 * JavaScript DSN Detector Tests
 *
 * Consolidated tests for extracting DSN from JavaScript/TypeScript source code.
 * Tests cover: basic init, config object, multiple DSNs, env filtering, detector config.
 */

import { describe, expect, test } from "bun:test";
import {
  extractDsnFromCode,
  javascriptDetector,
} from "../../../../src/lib/dsn/languages/javascript.js";

const TEST_DSN = "https://abc123@o456.ingest.sentry.io/789";

describe("JavaScript DSN Detector", () => {
  test("extracts DSN from basic Sentry.init", () => {
    const code = `
      import * as Sentry from "@sentry/react";

      Sentry.init({
        dsn: "${TEST_DSN}",
        tracesSampleRate: 1.0,
      });
    `;
    expect(extractDsnFromCode(code)).toBe(TEST_DSN);
  });

  test("extracts DSN from config object", () => {
    const code = `
      export const sentryConfig = {
        dsn: "${TEST_DSN}",
        enabled: true,
      };
    `;
    expect(extractDsnFromCode(code)).toBe(TEST_DSN);
  });

  test("extracts first DSN when multiple exist", () => {
    const dsn2 = "https://xyz@o999.ingest.sentry.io/111";
    const code = `
      Sentry.init({ dsn: "${TEST_DSN}" });
      const backup = { dsn: "${dsn2}" };
    `;
    expect(extractDsnFromCode(code)).toBe(TEST_DSN);
  });

  test("returns null for DSN from env variable", () => {
    const code = `
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
      });
    `;
    expect(extractDsnFromCode(code)).toBeNull();
  });

  test("detector has correct configuration", () => {
    expect(javascriptDetector.name).toBe("JavaScript");
    expect(javascriptDetector.extensions).toContain(".ts");
    expect(javascriptDetector.extensions).toContain(".js");
    expect(javascriptDetector.skipDirs).toContain("node_modules");
    expect(javascriptDetector.extractDsn).toBe(extractDsnFromCode);
  });
});
