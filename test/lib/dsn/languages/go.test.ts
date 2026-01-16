/**
 * Go DSN Detector Tests
 *
 * Tests for extracting DSN from Go source code.
 */

import { describe, expect, test } from "bun:test";
import {
  extractDsnFromGo,
  goDetector,
} from "../../../../src/lib/dsn/languages/go.js";

const TEST_DSN = "https://abc123@o456.ingest.sentry.io/789";

describe("Go DSN Detector", () => {
  describe("extractDsnFromGo", () => {
    describe("struct field pattern", () => {
      test("extracts DSN from sentry.Init with ClientOptions", () => {
        const code = `
package main

import "github.com/getsentry/sentry-go"

func main() {
	sentry.Init(sentry.ClientOptions{
		Dsn: "${TEST_DSN}",
	})
}
`;
        expect(extractDsnFromGo(code)).toBe(TEST_DSN);
      });

      test("extracts DSN with single quotes (raw string)", () => {
        const code = `
sentry.Init(sentry.ClientOptions{
	Dsn: '${TEST_DSN}',
})
`;
        expect(extractDsnFromGo(code)).toBe(TEST_DSN);
      });

      test("extracts DSN from multiline struct", () => {
        const code = `
err := sentry.Init(sentry.ClientOptions{
	Dsn:              "${TEST_DSN}",
	Environment:      "production",
	TracesSampleRate: 1.0,
})
`;
        expect(extractDsnFromGo(code)).toBe(TEST_DSN);
      });

      test("extracts DSN when not first field", () => {
        const code = `
sentry.Init(sentry.ClientOptions{
	Environment: "production",
	Dsn:         "${TEST_DSN}",
	Debug:       true,
})
`;
        expect(extractDsnFromGo(code)).toBe(TEST_DSN);
      });
    });

    describe("assignment pattern", () => {
      test("extracts DSN from short variable declaration", () => {
        const code = `
dsn := "${TEST_DSN}"
sentry.Init(sentry.ClientOptions{Dsn: dsn})
`;
        expect(extractDsnFromGo(code)).toBe(TEST_DSN);
      });

      test("extracts DSN from regular assignment", () => {
        const code = `
var dsn string
dsn = "${TEST_DSN}"
`;
        expect(extractDsnFromGo(code)).toBe(TEST_DSN);
      });

      test("extracts DSN with backtick (raw string literal)", () => {
        const code = `
dsn := \`${TEST_DSN}\`
`;
        expect(extractDsnFromGo(code)).toBe(TEST_DSN);
      });
    });

    describe("edge cases", () => {
      test("returns null when no DSN found", () => {
        const code = `
package main

import "fmt"

func main() {
	fmt.Println("Hello world")
}
`;
        expect(extractDsnFromGo(code)).toBeNull();
      });

      test("returns null for empty content", () => {
        expect(extractDsnFromGo("")).toBeNull();
      });

      test("returns null for DSN from os.Getenv", () => {
        const code = `
sentry.Init(sentry.ClientOptions{
	Dsn: os.Getenv("SENTRY_DSN"),
})
`;
        expect(extractDsnFromGo(code)).toBeNull();
      });

      test("returns null for DSN from viper config", () => {
        const code = `
sentry.Init(sentry.ClientOptions{
	Dsn: viper.GetString("sentry.dsn"),
})
`;
        expect(extractDsnFromGo(code)).toBeNull();
      });
    });
  });

  describe("goDetector configuration", () => {
    test("has correct name", () => {
      expect(goDetector.name).toBe("Go");
    });

    test("includes .go extension", () => {
      expect(goDetector.extensions).toContain(".go");
    });

    test("skips vendor directory", () => {
      expect(goDetector.skipDirs).toContain("vendor");
    });

    test("skips testdata directory", () => {
      expect(goDetector.skipDirs).toContain("testdata");
    });

    test("extractDsn is the extractDsnFromGo function", () => {
      expect(goDetector.extractDsn).toBe(extractDsnFromGo);
    });
  });
});
