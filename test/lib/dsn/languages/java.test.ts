/**
 * Java/Kotlin DSN Detector Tests
 *
 * Consolidated tests for extracting DSN from Java/Kotlin source code and properties files.
 * Tests cover: Sentry.init, properties file, Kotlin pattern, env filtering, detector config.
 */

import { describe, expect, test } from "bun:test";
import {
  extractDsnFromJava,
  javaDetector,
} from "../../../../src/lib/dsn/languages/java.js";

const TEST_DSN = "https://abc123@o456.ingest.sentry.io/789";

describe("Java DSN Detector", () => {
  test("extracts DSN from Sentry.init with setDsn", () => {
    const code = `
import io.sentry.Sentry;

public class SentryConfig {
    public static void init() {
        Sentry.init(options -> {
            options.setDsn("${TEST_DSN}");
            options.setEnvironment("production");
        });
    }
}
`;
    expect(extractDsnFromJava(code)).toBe(TEST_DSN);
  });

  test("extracts DSN from sentry.properties file", () => {
    const content = `
# Sentry configuration
dsn=${TEST_DSN}
environment=production
`;
    expect(extractDsnFromJava(content)).toBe(TEST_DSN);
  });

  test("extracts DSN from Kotlin companion object", () => {
    const code = `
companion object {
    const val dsn = "${TEST_DSN}"
}
`;
    expect(extractDsnFromJava(code)).toBe(TEST_DSN);
  });

  test("returns null for DSN from System.getenv", () => {
    const code = `
Sentry.init(options -> {
    options.setDsn(System.getenv("SENTRY_DSN"));
});
`;
    expect(extractDsnFromJava(code)).toBeNull();
  });

  test("detector has correct configuration", () => {
    expect(javaDetector.name).toBe("Java");
    expect(javaDetector.extensions).toContain(".java");
    expect(javaDetector.extensions).toContain(".kt");
    expect(javaDetector.extensions).toContain(".properties");
    expect(javaDetector.skipDirs).toContain("target");
    expect(javaDetector.skipDirs).toContain("build");
    expect(javaDetector.extractDsn).toBe(extractDsnFromJava);
  });
});
