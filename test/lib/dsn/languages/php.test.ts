/**
 * PHP DSN Detector Tests
 *
 * Tests for extracting DSN from PHP source code.
 */

import { describe, expect, test } from "bun:test";
import {
  extractDsnFromPhp,
  phpDetector,
} from "../../../../src/lib/dsn/languages/php.js";

const TEST_DSN = "https://abc123@o456.ingest.sentry.io/789";

describe("PHP DSN Detector", () => {
  describe("extractDsnFromPhp", () => {
    describe("Sentry\\init pattern", () => {
      test("extracts DSN from Sentry\\init with single quotes", () => {
        const code = `
<?php
\\Sentry\\init(['dsn' => '${TEST_DSN}']);
`;
        expect(extractDsnFromPhp(code)).toBe(TEST_DSN);
      });

      test("extracts DSN from Sentry\\init with double quotes", () => {
        const code = `
<?php
\\Sentry\\init(["dsn" => "${TEST_DSN}"]);
`;
        expect(extractDsnFromPhp(code)).toBe(TEST_DSN);
      });

      test("extracts DSN without leading backslash", () => {
        const code = `
<?php
use Sentry;
Sentry\\init(['dsn' => '${TEST_DSN}']);
`;
        expect(extractDsnFromPhp(code)).toBe(TEST_DSN);
      });

      test("extracts DSN from multiline init", () => {
        const code = `
<?php
\\Sentry\\init([
    'dsn' => '${TEST_DSN}',
    'environment' => 'production',
]);
`;
        expect(extractDsnFromPhp(code)).toBe(TEST_DSN);
      });

      test("extracts DSN when not first in array", () => {
        const code = `
<?php
\\Sentry\\init([
    'environment' => 'production',
    'dsn' => '${TEST_DSN}',
    'traces_sample_rate' => 1.0,
]);
`;
        expect(extractDsnFromPhp(code)).toBe(TEST_DSN);
      });
    });

    describe("generic array pattern", () => {
      test("extracts DSN from config array", () => {
        const code = `
<?php
return [
    'dsn' => '${TEST_DSN}',
    'release' => 'v1.0.0',
];
`;
        expect(extractDsnFromPhp(code)).toBe(TEST_DSN);
      });

      test("extracts DSN from Laravel config style", () => {
        const code = `
<?php
return [
    'sentry' => [
        'dsn' => '${TEST_DSN}',
    ],
];
`;
        expect(extractDsnFromPhp(code)).toBe(TEST_DSN);
      });

      test("extracts DSN with double quotes in array", () => {
        const code = `
<?php
$config = [
    "dsn" => "${TEST_DSN}",
];
`;
        expect(extractDsnFromPhp(code)).toBe(TEST_DSN);
      });
    });

    describe("edge cases", () => {
      test("returns null when no DSN found", () => {
        const code = `
<?php
echo "Hello world";
`;
        expect(extractDsnFromPhp(code)).toBeNull();
      });

      test("returns null for empty content", () => {
        expect(extractDsnFromPhp("")).toBeNull();
      });

      test("returns null for DSN from env function", () => {
        const code = `
<?php
\\Sentry\\init(['dsn' => env('SENTRY_DSN')]);
`;
        expect(extractDsnFromPhp(code)).toBeNull();
      });

      test("returns null for DSN from getenv", () => {
        const code = `
<?php
\\Sentry\\init(['dsn' => getenv('SENTRY_DSN')]);
`;
        expect(extractDsnFromPhp(code)).toBeNull();
      });
    });
  });

  describe("phpDetector configuration", () => {
    test("has correct name", () => {
      expect(phpDetector.name).toBe("PHP");
    });

    test("includes .php extension", () => {
      expect(phpDetector.extensions).toContain(".php");
    });

    test("skips vendor directory", () => {
      expect(phpDetector.skipDirs).toContain("vendor");
    });

    test("skips cache directory", () => {
      expect(phpDetector.skipDirs).toContain("cache");
    });

    test("extractDsn is the extractDsnFromPhp function", () => {
      expect(phpDetector.extractDsn).toBe(extractDsnFromPhp);
    });
  });
});
