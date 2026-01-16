/**
 * Python DSN Detector Tests
 *
 * Tests for extracting DSN from Python source code.
 */

import { describe, expect, test } from "bun:test";
import {
  extractDsnFromPython,
  pythonDetector,
} from "../../../../src/lib/dsn/languages/python.js";

const TEST_DSN = "https://abc123@o456.ingest.sentry.io/789";

describe("Python DSN Detector", () => {
  describe("extractDsnFromPython", () => {
    describe("sentry_sdk.init pattern", () => {
      test("extracts DSN from basic sentry_sdk.init with double quotes", () => {
        const code = `
import sentry_sdk

sentry_sdk.init(dsn="${TEST_DSN}")
`;
        expect(extractDsnFromPython(code)).toBe(TEST_DSN);
      });

      test("extracts DSN from sentry_sdk.init with single quotes", () => {
        const code = `sentry_sdk.init(dsn='${TEST_DSN}')`;
        expect(extractDsnFromPython(code)).toBe(TEST_DSN);
      });

      test("extracts DSN from multiline sentry_sdk.init", () => {
        const code = `
sentry_sdk.init(
    dsn="${TEST_DSN}",
    traces_sample_rate=1.0,
)
`;
        expect(extractDsnFromPython(code)).toBe(TEST_DSN);
      });

      test("extracts DSN when not first argument", () => {
        const code = `
sentry_sdk.init(
    environment="production",
    dsn="${TEST_DSN}",
)
`;
        expect(extractDsnFromPython(code)).toBe(TEST_DSN);
      });

      test("extracts DSN with integrations", () => {
        const code = `
sentry_sdk.init(
    dsn="${TEST_DSN}",
    integrations=[
        DjangoIntegration(),
    ],
)
`;
        expect(extractDsnFromPython(code)).toBe(TEST_DSN);
      });
    });

    describe("dict-style config pattern", () => {
      test("extracts DSN from dict with double quotes", () => {
        const code = `
SENTRY_CONFIG = {
    "dsn": "${TEST_DSN}",
    "environment": "production",
}
`;
        expect(extractDsnFromPython(code)).toBe(TEST_DSN);
      });

      test("extracts DSN from dict with single quotes", () => {
        const code = `
SENTRY_CONFIG = {
    'dsn': '${TEST_DSN}',
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
    });

    describe("edge cases", () => {
      test("returns null when no DSN found", () => {
        const code = `
import sentry_sdk
print("Hello world")
`;
        expect(extractDsnFromPython(code)).toBeNull();
      });

      test("returns null for empty content", () => {
        expect(extractDsnFromPython("")).toBeNull();
      });

      test("returns null for DSN from env variable", () => {
        const code = `
import os
sentry_sdk.init(dsn=os.environ.get("SENTRY_DSN"))
`;
        expect(extractDsnFromPython(code)).toBeNull();
      });

      test("returns null for DSN from getenv", () => {
        const code = `
sentry_sdk.init(dsn=os.getenv("SENTRY_DSN"))
`;
        expect(extractDsnFromPython(code)).toBeNull();
      });
    });
  });

  describe("pythonDetector configuration", () => {
    test("has correct name", () => {
      expect(pythonDetector.name).toBe("Python");
    });

    test("includes .py extension", () => {
      expect(pythonDetector.extensions).toContain(".py");
    });

    test("skips virtual environment directories", () => {
      expect(pythonDetector.skipDirs).toContain("venv");
      expect(pythonDetector.skipDirs).toContain(".venv");
      expect(pythonDetector.skipDirs).toContain("env");
    });

    test("skips __pycache__", () => {
      expect(pythonDetector.skipDirs).toContain("__pycache__");
    });

    test("skips common cache directories", () => {
      expect(pythonDetector.skipDirs).toContain(".pytest_cache");
      expect(pythonDetector.skipDirs).toContain(".mypy_cache");
    });

    test("extractDsn is the extractDsnFromPython function", () => {
      expect(pythonDetector.extractDsn).toBe(extractDsnFromPython);
    });
  });
});
