/**
 * DSN Detection Tests
 *
 * Integration tests for DSN auto-detection from environment, files, and code.
 * Unit tests for DSN parsing are in dsn.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { detectDsn, getDsnSourceDescription } from "../../src/lib/dsn/index.js";
import { tmpdir } from "../fixture.js";

describe("detectDsn", () => {
  beforeEach(() => {
    // Clear environment before each test
    delete process.env.SENTRY_DSN;
  });

  afterEach(() => {
    // Clean up after each test
    delete process.env.SENTRY_DSN;
  });

  describe("from environment variable", () => {
    test("returns DSN when SENTRY_DSN is set and no other sources exist", async () => {
      const dsn = "https://key@o123.ingest.sentry.io/456";
      process.env.SENTRY_DSN = dsn;

      // Use proper temp directory (empty, so only env var is available)
      await using tmp = await tmpdir();
      const result = await detectDsn(tmp.path);

      expect(result).toEqual({
        protocol: "https",
        publicKey: "key",
        host: "o123.ingest.sentry.io",
        projectId: "456",
        orgId: "123",
        raw: dsn,
        source: "env",
      });
    });

    test("returns null for invalid SENTRY_DSN", async () => {
      process.env.SENTRY_DSN = "invalid-dsn";

      // Use a proper temp directory
      await using tmp = await tmpdir();
      const result = await detectDsn(tmp.path);

      expect(result).toBeNull();
    });
  });

  describe("from .env files", () => {
    test("detects from .env when no env var set", async () => {
      const fileDsn = "https://file@o222.ingest.sentry.io/222";

      await using tmp = await tmpdir({
        env: { SENTRY_DSN: fileDsn },
      });

      const result = await detectDsn(tmp.path);

      expect(result?.raw).toBe(fileDsn);
      expect(result?.source).toBe("env_file");
    });

    test(".env file takes priority over env var", async () => {
      const envDsn = "https://env@o111.ingest.sentry.io/111";
      const fileDsn = "https://file@o222.ingest.sentry.io/222";

      process.env.SENTRY_DSN = envDsn;

      await using tmp = await tmpdir({
        env: { SENTRY_DSN: fileDsn },
      });

      const result = await detectDsn(tmp.path);

      // .env file has higher priority than env var
      expect(result?.raw).toBe(fileDsn);
      expect(result?.source).toBe("env_file");
    });

    test(".env.local takes priority over .env", async () => {
      const envDsn = "https://env@o111.ingest.sentry.io/111";
      const localDsn = "https://local@o333.ingest.sentry.io/333";

      await using tmp = await tmpdir({
        files: {
          ".env": `SENTRY_DSN=${envDsn}`,
          ".env.local": `SENTRY_DSN=${localDsn}`,
        },
      });

      const result = await detectDsn(tmp.path);

      expect(result?.raw).toBe(localDsn);
      expect(result?.source).toBe("env_file");
    });
  });

  describe("from source code", () => {
    test("detects Sentry.init pattern in TypeScript", async () => {
      const dsn = "https://key@o123.ingest.sentry.io/456";

      await using tmp = await tmpdir({
        files: {
          "index.ts": `
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "${dsn}",
});
          `,
        },
      });

      const result = await detectDsn(tmp.path);

      expect(result?.raw).toBe(dsn);
      expect(result?.source).toBe("code");
      expect(result?.sourcePath).toContain("index.ts");
    });

    test("detects Sentry.init pattern in JavaScript", async () => {
      const dsn = "https://key@o123.ingest.sentry.io/456";

      await using tmp = await tmpdir({
        files: {
          "app.js": `
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: "${dsn}",
});
          `,
        },
      });

      const result = await detectDsn(tmp.path);

      expect(result?.raw).toBe(dsn);
      expect(result?.source).toBe("code");
      expect(result?.sourcePath).toContain("app.js");
    });

    test("detects generic dsn pattern in config", async () => {
      const dsn = "https://key@o123.ingest.sentry.io/456";

      await using tmp = await tmpdir({
        files: {
          "config.ts": `
export const config = {
  dsn: "${dsn}",
};
          `,
        },
      });

      const result = await detectDsn(tmp.path);

      expect(result?.raw).toBe(dsn);
      expect(result?.source).toBe("code");
      expect(result?.sourcePath).toContain("config.ts");
    });

    test("skips node_modules directory", async () => {
      const dsn = "https://key@o123.ingest.sentry.io/456";

      await using tmp = await tmpdir({
        files: {
          "node_modules/package/index.js": `
const Sentry = require("@sentry/node");
Sentry.init({ dsn: "${dsn}" });
          `,
        },
      });

      const result = await detectDsn(tmp.path);

      expect(result).toBeNull();
    });

    test("skips dist directory", async () => {
      const dsn = "https://key@o123.ingest.sentry.io/456";

      await using tmp = await tmpdir({
        files: {
          "dist/bundle.js": `Sentry.init({ dsn: "${dsn}" });`,
        },
      });

      const result = await detectDsn(tmp.path);

      expect(result).toBeNull();
    });
  });

  describe("priority order", () => {
    test("code takes highest priority", async () => {
      const envDsn = "https://env@o111.ingest.sentry.io/111";
      const fileDsn = "https://file@o222.ingest.sentry.io/222";
      const codeDsn = "https://code@o333.ingest.sentry.io/333";

      process.env.SENTRY_DSN = envDsn;

      await using tmp = await tmpdir({
        env: { SENTRY_DSN: fileDsn },
        files: {
          "index.ts": `Sentry.init({ dsn: "${codeDsn}" })`,
        },
      });

      const result = await detectDsn(tmp.path);

      // Code DSN has highest priority
      expect(result?.raw).toBe(codeDsn);
      expect(result?.source).toBe("code");
    });

    test("code takes priority over .env file", async () => {
      const fileDsn = "https://file@o222.ingest.sentry.io/222";
      const codeDsn = "https://code@o333.ingest.sentry.io/333";

      await using tmp = await tmpdir({
        env: { SENTRY_DSN: fileDsn },
        files: {
          "index.ts": `Sentry.init({ dsn: "${codeDsn}" })`,
        },
      });

      const result = await detectDsn(tmp.path);

      // Code DSN has higher priority than .env file
      expect(result?.raw).toBe(codeDsn);
      expect(result?.source).toBe("code");
    });

    test(".env file takes priority over env var", async () => {
      const envDsn = "https://env@o111.ingest.sentry.io/111";
      const fileDsn = "https://file@o222.ingest.sentry.io/222";

      process.env.SENTRY_DSN = envDsn;

      await using tmp = await tmpdir({
        env: { SENTRY_DSN: fileDsn },
      });

      const result = await detectDsn(tmp.path);

      // .env file has higher priority than env var
      expect(result?.raw).toBe(fileDsn);
      expect(result?.source).toBe("env_file");
    });

    test("env var is used when no code or .env file exists", async () => {
      const envDsn = "https://env@o111.ingest.sentry.io/111";

      process.env.SENTRY_DSN = envDsn;

      await using tmp = await tmpdir();

      const result = await detectDsn(tmp.path);

      expect(result?.raw).toBe(envDsn);
      expect(result?.source).toBe("env");
    });
  });

  describe("edge cases", () => {
    test("returns null when no DSN found", async () => {
      await using tmp = await tmpdir();

      const result = await detectDsn(tmp.path);

      expect(result).toBeNull();
    });

    test("returns null for invalid DSN in .env", async () => {
      await using tmp = await tmpdir({
        env: { SENTRY_DSN: "invalid-dsn" },
      });

      const result = await detectDsn(tmp.path);

      expect(result).toBeNull();
    });

    test("returns null for invalid DSN in code", async () => {
      await using tmp = await tmpdir({
        files: {
          "index.ts": `Sentry.init({ dsn: "invalid-dsn" })`,
        },
      });

      const result = await detectDsn(tmp.path);

      expect(result).toBeNull();
    });
  });
});

describe("getDsnSourceDescription", () => {
  test("describes env source", () => {
    const dsn = {
      protocol: "https",
      publicKey: "key",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
      raw: "https://key@o123.ingest.sentry.io/456",
      source: "env" as const,
    };

    const description = getDsnSourceDescription(dsn);
    expect(description).toBe("SENTRY_DSN environment variable");
  });

  test("describes env_file source with path", () => {
    const dsn = {
      protocol: "https",
      publicKey: "key",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
      raw: "https://key@o123.ingest.sentry.io/456",
      source: "env_file" as const,
      sourcePath: "/path/to/.env",
    };

    const description = getDsnSourceDescription(dsn);
    expect(description).toBe("/path/to/.env");
  });

  test("describes code source with path", () => {
    const dsn = {
      protocol: "https",
      publicKey: "key",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
      raw: "https://key@o123.ingest.sentry.io/456",
      source: "code" as const,
      sourcePath: "/path/to/index.ts",
    };

    const description = getDsnSourceDescription(dsn);
    expect(description).toBe("/path/to/index.ts");
  });
});
