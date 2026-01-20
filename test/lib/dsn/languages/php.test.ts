/**
 * PHP DSN Detector Tests
 *
 * Consolidated tests for extracting DSN from PHP source code.
 * Tests cover: Sentry\init, Laravel config, multiline init, env filtering, detector config.
 */

import { describe, expect, test } from "bun:test";
import {
  extractDsnFromPhp,
  phpDetector,
} from "../../../../src/lib/dsn/languages/php.js";

const TEST_DSN = "https://abc123@o456.ingest.sentry.io/789";

describe("PHP DSN Detector", () => {
  test("extracts DSN from Sentry\\init", () => {
    const code = `
<?php
\\Sentry\\init([
    'dsn' => '${TEST_DSN}',
    'environment' => 'production',
]);
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

  test("extracts DSN with double quotes", () => {
    const code = `
<?php
\\Sentry\\init(["dsn" => "${TEST_DSN}"]);
`;
    expect(extractDsnFromPhp(code)).toBe(TEST_DSN);
  });

  test("returns null for DSN from env function", () => {
    const code = `
<?php
\\Sentry\\init(['dsn' => env('SENTRY_DSN')]);
`;
    expect(extractDsnFromPhp(code)).toBeNull();
  });

  test("detector has correct configuration", () => {
    expect(phpDetector.name).toBe("PHP");
    expect(phpDetector.extensions).toContain(".php");
    expect(phpDetector.skipDirs).toContain("vendor");
    expect(phpDetector.extractDsn).toBe(extractDsnFromPhp);
  });
});
