/**
 * Go DSN Detector Tests
 *
 * Consolidated tests for extracting DSN from Go source code.
 * Tests cover: ClientOptions struct, variable assignment, raw string, env filtering, detector config.
 */

import { describe, expect, test } from "bun:test";
import {
  extractDsnFromGo,
  goDetector,
} from "../../../../src/lib/dsn/languages/go.js";

const TEST_DSN = "https://abc123@o456.ingest.sentry.io/789";

describe("Go DSN Detector", () => {
  test("extracts DSN from sentry.Init with ClientOptions", () => {
    const code = `
package main

import "github.com/getsentry/sentry-go"

func main() {
	err := sentry.Init(sentry.ClientOptions{
		Dsn:              "${TEST_DSN}",
		Environment:      "production",
		TracesSampleRate: 1.0,
	})
}
`;
    expect(extractDsnFromGo(code)).toBe(TEST_DSN);
  });

  test("extracts DSN from variable assignment", () => {
    const code = `
dsn := "${TEST_DSN}"
sentry.Init(sentry.ClientOptions{Dsn: dsn})
`;
    expect(extractDsnFromGo(code)).toBe(TEST_DSN);
  });

  test("extracts DSN with backtick raw string literal", () => {
    const code = `
dsn := \`${TEST_DSN}\`
`;
    expect(extractDsnFromGo(code)).toBe(TEST_DSN);
  });

  test("returns null for DSN from os.Getenv", () => {
    const code = `
sentry.Init(sentry.ClientOptions{
	Dsn: os.Getenv("SENTRY_DSN"),
})
`;
    expect(extractDsnFromGo(code)).toBeNull();
  });

  test("detector has correct configuration", () => {
    expect(goDetector.name).toBe("Go");
    expect(goDetector.extensions).toContain(".go");
    expect(goDetector.skipDirs).toContain("vendor");
    expect(goDetector.extractDsn).toBe(extractDsnFromGo);
  });
});
