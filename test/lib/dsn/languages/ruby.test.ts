/**
 * Ruby DSN Detector Tests
 *
 * Consolidated tests for extracting DSN from Ruby source code.
 * Tests cover: Sentry.init block, Rails initializer, hash patterns, env filtering, detector config.
 */

import { describe, expect, test } from "bun:test";
import {
  extractDsnFromRuby,
  rubyDetector,
} from "../../../../src/lib/dsn/languages/ruby.js";

const TEST_DSN = "https://abc123@o456.ingest.sentry.io/789";

describe("Ruby DSN Detector", () => {
  test("extracts DSN from Sentry.init block", () => {
    const code = `
Sentry.init do |config|
  config.dsn = '${TEST_DSN}'
  config.traces_sample_rate = 1.0
end
`;
    expect(extractDsnFromRuby(code)).toBe(TEST_DSN);
  });

  test("extracts DSN from Rails initializer style", () => {
    const code = `
Sentry.init do |config|
  config.dsn = '${TEST_DSN}'
  config.breadcrumbs_logger = [:active_support_logger]
  config.traces_sample_rate = 0.5
end
`;
    expect(extractDsnFromRuby(code)).toBe(TEST_DSN);
  });

  test("extracts DSN from symbol key hash", () => {
    const code = `
sentry_config = {
  dsn: '${TEST_DSN}',
  environment: 'production'
}
`;
    expect(extractDsnFromRuby(code)).toBe(TEST_DSN);
  });

  test("returns null for DSN from ENV", () => {
    const code = `
Sentry.init do |config|
  config.dsn = ENV['SENTRY_DSN']
end
`;
    expect(extractDsnFromRuby(code)).toBeNull();
  });

  test("detector has correct configuration", () => {
    expect(rubyDetector.name).toBe("Ruby");
    expect(rubyDetector.extensions).toContain(".rb");
    expect(rubyDetector.skipDirs).toContain("vendor/bundle");
    expect(rubyDetector.extractDsn).toBe(extractDsnFromRuby);
  });
});
