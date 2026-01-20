/**
 * Python DSN Detector Tests
 *
 * Consolidated tests for extracting DSN from Python source code.
 * Tests cover: basic init, dict config, Django settings, env filtering, detector config.
 */

import { describe, expect, test } from "bun:test";
import {
  extractDsnFromPython,
  pythonDetector,
} from "../../../../src/lib/dsn/languages/python.js";

const TEST_DSN = "https://abc123@o456.ingest.sentry.io/789";

describe("Python DSN Detector", () => {
  test("extracts DSN from basic sentry_sdk.init", () => {
    const code = `
import sentry_sdk

sentry_sdk.init(
    dsn="${TEST_DSN}",
    traces_sample_rate=1.0,
)
`;
    expect(extractDsnFromPython(code)).toBe(TEST_DSN);
  });

  test("extracts DSN from dict config", () => {
    const code = `
SENTRY_CONFIG = {
    "dsn": "${TEST_DSN}",
    "environment": "production",
}
`;
    expect(extractDsnFromPython(code)).toBe(TEST_DSN);
  });

  test("extracts DSN from Django settings style", () => {
    const code = `
SENTRY_DSN = "${TEST_DSN}"

LOGGING = {
    "handlers": {
        "sentry": {
            "dsn": "${TEST_DSN}",
        }
    }
}
`;
    expect(extractDsnFromPython(code)).toBe(TEST_DSN);
  });

  test("returns null for DSN from env variable", () => {
    const code = `
import os
sentry_sdk.init(dsn=os.environ.get("SENTRY_DSN"))
`;
    expect(extractDsnFromPython(code)).toBeNull();
  });

  test("detector has correct configuration", () => {
    expect(pythonDetector.name).toBe("Python");
    expect(pythonDetector.extensions).toContain(".py");
    expect(pythonDetector.skipDirs).toContain("venv");
    expect(pythonDetector.skipDirs).toContain("__pycache__");
    expect(pythonDetector.extractDsn).toBe(extractDsnFromPython);
  });
});
