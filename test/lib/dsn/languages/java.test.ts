/**
 * Java/Kotlin DSN Detector Tests
 *
 * Tests for extracting DSN from Java and Kotlin source code,
 * as well as sentry.properties files.
 */

import { describe, expect, test } from "bun:test";
import {
  extractDsnFromJava,
  javaDetector,
} from "../../../../src/lib/dsn/languages/java.js";

const TEST_DSN = "https://abc123@o456.ingest.sentry.io/789";

describe("Java DSN Detector", () => {
  describe("extractDsnFromJava", () => {
    describe("setDsn pattern", () => {
      test("extracts DSN from options.setDsn with double quotes", () => {
        const code = `
import io.sentry.Sentry;
import io.sentry.SentryOptions;

public class SentryConfig {
    public static void init() {
        Sentry.init(options -> {
            options.setDsn("${TEST_DSN}");
        });
    }
}
`;
        expect(extractDsnFromJava(code)).toBe(TEST_DSN);
      });

      test("extracts DSN from setDsn with single quotes (Kotlin)", () => {
        const code = `
Sentry.init { options ->
    options.setDsn('${TEST_DSN}')
}
`;
        expect(extractDsnFromJava(code)).toBe(TEST_DSN);
      });

      test("extracts DSN from chained setDsn call", () => {
        const code = `
Sentry.init(options -> options
    .setDsn("${TEST_DSN}")
    .setEnvironment("production")
);
`;
        expect(extractDsnFromJava(code)).toBe(TEST_DSN);
      });

      test("extracts DSN from options object", () => {
        const code = `
SentryOptions options = new SentryOptions();
options.setDsn("${TEST_DSN}");
options.setEnvironment("production");
Sentry.init(options);
`;
        expect(extractDsnFromJava(code)).toBe(TEST_DSN);
      });
    });

    describe("properties file pattern", () => {
      test("extracts DSN from sentry.properties", () => {
        const content = `
# Sentry configuration
dsn=${TEST_DSN}
environment=production
`;
        expect(extractDsnFromJava(content)).toBe(TEST_DSN);
      });

      test("extracts DSN from properties with no spaces", () => {
        const content = `dsn=${TEST_DSN}`;
        expect(extractDsnFromJava(content)).toBe(TEST_DSN);
      });

      test("extracts DSN from properties with spaces around equals", () => {
        const content = `dsn = ${TEST_DSN}`;
        expect(extractDsnFromJava(content)).toBe(TEST_DSN);
      });

      test("ignores invalid DSN in properties", () => {
        const content = "dsn=not-a-valid-dsn";
        expect(extractDsnFromJava(content)).toBeNull();
      });
    });

    describe("generic pattern", () => {
      test("extracts DSN from annotation-style config", () => {
        const code = `
@Configuration
public class SentryConfig {
    private String dsn = "${TEST_DSN}";
}
`;
        expect(extractDsnFromJava(code)).toBe(TEST_DSN);
      });

      test("extracts DSN from Kotlin companion object", () => {
        const code = `
companion object {
    const val dsn = "${TEST_DSN}"
}
`;
        expect(extractDsnFromJava(code)).toBe(TEST_DSN);
      });

      test("extracts DSN from Map initialization", () => {
        const code = `
Map<String, String> config = Map.of(
    "dsn", "${TEST_DSN}",
    "environment", "production"
);
`;
        expect(extractDsnFromJava(code)).toBe(TEST_DSN);
      });
    });

    describe("edge cases", () => {
      test("returns null when no DSN found", () => {
        const code = `
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello world");
    }
}
`;
        expect(extractDsnFromJava(code)).toBeNull();
      });

      test("returns null for empty content", () => {
        expect(extractDsnFromJava("")).toBeNull();
      });

      test("returns null for DSN from System.getenv", () => {
        const code = `
Sentry.init(options -> {
    options.setDsn(System.getenv("SENTRY_DSN"));
});
`;
        expect(extractDsnFromJava(code)).toBeNull();
      });

      test("returns null for DSN from properties.getProperty", () => {
        const code = `
Sentry.init(options -> {
    options.setDsn(properties.getProperty("sentry.dsn"));
});
`;
        expect(extractDsnFromJava(code)).toBeNull();
      });

      test("returns null for DSN from BuildConfig (Android)", () => {
        const code = `
Sentry.init(options -> {
    options.setDsn(BuildConfig.SENTRY_DSN);
});
`;
        expect(extractDsnFromJava(code)).toBeNull();
      });
    });
  });

  describe("javaDetector configuration", () => {
    test("has correct name", () => {
      expect(javaDetector.name).toBe("Java");
    });

    test("includes Java extension", () => {
      expect(javaDetector.extensions).toContain(".java");
    });

    test("includes Kotlin extension", () => {
      expect(javaDetector.extensions).toContain(".kt");
    });

    test("includes properties extension", () => {
      expect(javaDetector.extensions).toContain(".properties");
    });

    test("skips target directory (Maven)", () => {
      expect(javaDetector.skipDirs).toContain("target");
    });

    test("skips build directory (Gradle)", () => {
      expect(javaDetector.skipDirs).toContain("build");
    });

    test("skips .gradle directory", () => {
      expect(javaDetector.skipDirs).toContain(".gradle");
    });

    test("skips .idea directory", () => {
      expect(javaDetector.skipDirs).toContain(".idea");
    });

    test("extractDsn is the extractDsnFromJava function", () => {
      expect(javaDetector.extractDsn).toBe(extractDsnFromJava);
    });
  });
});
