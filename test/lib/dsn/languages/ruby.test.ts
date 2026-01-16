/**
 * Ruby DSN Detector Tests
 *
 * Tests for extracting DSN from Ruby source code.
 */

import { describe, expect, test } from "bun:test";
import {
  extractDsnFromRuby,
  rubyDetector,
} from "../../../../src/lib/dsn/languages/ruby.js";

const TEST_DSN = "https://abc123@o456.ingest.sentry.io/789";

describe("Ruby DSN Detector", () => {
  describe("extractDsnFromRuby", () => {
    describe("config.dsn pattern", () => {
      test("extracts DSN from Sentry.init block with single quotes", () => {
        const code = `
Sentry.init do |config|
  config.dsn = '${TEST_DSN}'
end
`;
        expect(extractDsnFromRuby(code)).toBe(TEST_DSN);
      });

      test("extracts DSN from Sentry.init block with double quotes", () => {
        const code = `
Sentry.init do |config|
  config.dsn = "${TEST_DSN}"
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

      test("extracts DSN with spaces around equals", () => {
        const code = `config.dsn  =  "${TEST_DSN}"`;
        expect(extractDsnFromRuby(code)).toBe(TEST_DSN);
      });
    });

    describe("hash pattern", () => {
      test("extracts DSN from symbol key hash (new syntax)", () => {
        const code = `
sentry_config = {
  dsn: '${TEST_DSN}',
  environment: 'production'
}
`;
        expect(extractDsnFromRuby(code)).toBe(TEST_DSN);
      });

      test("extracts DSN from hash rocket syntax", () => {
        const code = `
sentry_config = {
  :dsn => '${TEST_DSN}',
  :environment => 'production'
}
`;
        expect(extractDsnFromRuby(code)).toBe(TEST_DSN);
      });

      test("extracts DSN with double quotes in hash", () => {
        const code = `
config = {
  dsn: "${TEST_DSN}"
}
`;
        expect(extractDsnFromRuby(code)).toBe(TEST_DSN);
      });
    });

    describe("edge cases", () => {
      test("returns null when no DSN found", () => {
        const code = `
puts "Hello world"
`;
        expect(extractDsnFromRuby(code)).toBeNull();
      });

      test("returns null for empty content", () => {
        expect(extractDsnFromRuby("")).toBeNull();
      });

      test("returns null for DSN from ENV", () => {
        const code = `
Sentry.init do |config|
  config.dsn = ENV['SENTRY_DSN']
end
`;
        expect(extractDsnFromRuby(code)).toBeNull();
      });

      test("returns null for DSN from ENV.fetch", () => {
        const code = `
Sentry.init do |config|
  config.dsn = ENV.fetch('SENTRY_DSN')
end
`;
        expect(extractDsnFromRuby(code)).toBeNull();
      });
    });
  });

  describe("rubyDetector configuration", () => {
    test("has correct name", () => {
      expect(rubyDetector.name).toBe("Ruby");
    });

    test("includes .rb extension", () => {
      expect(rubyDetector.extensions).toContain(".rb");
    });

    test("skips vendor/bundle", () => {
      expect(rubyDetector.skipDirs).toContain("vendor/bundle");
    });

    test("skips .bundle", () => {
      expect(rubyDetector.skipDirs).toContain(".bundle");
    });

    test("skips tmp and log directories", () => {
      expect(rubyDetector.skipDirs).toContain("tmp");
      expect(rubyDetector.skipDirs).toContain("log");
    });

    test("extractDsn is the extractDsnFromRuby function", () => {
      expect(rubyDetector.extractDsn).toBe(extractDsnFromRuby);
    });
  });
});
