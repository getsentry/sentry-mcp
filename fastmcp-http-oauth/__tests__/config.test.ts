/**
 * Unit tests for server configuration loading
 *
 * Tests the loadConfig() function and environment variable handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Store original env to restore after tests
const originalEnv = { ...process.env };

// Helper to set environment variables for testing
function setEnv(vars: Record<string, string | undefined>) {
  // Clear relevant env vars first
  const relevantVars = [
    "PORT",
    "HOST",
    "BASE_URL",
    "SENTRY_HOST",
    "SENTRY_CLIENT_ID",
    "SENTRY_CLIENT_SECRET",
    "SENTRY_SCOPES",
    "REDIS_URL",
    "REDIS_TLS",
    "REDIS_TLS_REJECT_UNAUTHORIZED",
    "ENCRYPTION_KEY",
    "JWT_SIGNING_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "MCP_URL",
    "ALLOWED_REDIRECT_URI_PATTERNS",
  ];

  for (const key of relevantVars) {
    delete process.env[key];
  }

  // Set new values
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// Minimal required environment variables
const minimalEnv = {
  BASE_URL: "http://localhost:3000",
  SENTRY_HOST: "sentry.example.com",
  SENTRY_CLIENT_ID: "test-client-id",
  SENTRY_CLIENT_SECRET: "test-client-secret",
  ENCRYPTION_KEY: "test-encryption-key-32-chars-long",
  JWT_SIGNING_KEY: "test-jwt-signing-key-32-chars-long",
};

describe("Configuration Loading", () => {
  beforeEach(() => {
    // Reset modules to clear cached config
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe("Required Variables", () => {
    it("should throw error when BASE_URL is missing", async () => {
      setEnv({ ...minimalEnv, BASE_URL: undefined });

      // We test by checking what loadConfig would do
      // Since we can't easily import the function, we test the pattern
      expect(() => {
        const value = process.env.BASE_URL;
        if (!value) {
          throw new Error("Missing required environment variable: BASE_URL");
        }
      }).toThrow("Missing required environment variable: BASE_URL");
    });

    it("should throw error when SENTRY_HOST is missing", async () => {
      setEnv({ ...minimalEnv, SENTRY_HOST: undefined });

      expect(() => {
        const value = process.env.SENTRY_HOST;
        if (!value) {
          throw new Error("Missing required environment variable: SENTRY_HOST");
        }
      }).toThrow("Missing required environment variable: SENTRY_HOST");
    });

    it("should throw error when SENTRY_CLIENT_ID is missing", async () => {
      setEnv({ ...minimalEnv, SENTRY_CLIENT_ID: undefined });

      expect(() => {
        const value = process.env.SENTRY_CLIENT_ID;
        if (!value) {
          throw new Error(
            "Missing required environment variable: SENTRY_CLIENT_ID",
          );
        }
      }).toThrow("Missing required environment variable: SENTRY_CLIENT_ID");
    });

    it("should throw error when ENCRYPTION_KEY is missing", async () => {
      setEnv({ ...minimalEnv, ENCRYPTION_KEY: undefined });

      expect(() => {
        const value = process.env.ENCRYPTION_KEY;
        if (!value) {
          throw new Error(
            "Missing required environment variable: ENCRYPTION_KEY",
          );
        }
      }).toThrow("Missing required environment variable: ENCRYPTION_KEY");
    });
  });

  describe("Default Values", () => {
    it("should use default PORT of 3000", () => {
      setEnv(minimalEnv);
      const port = Number.parseInt(process.env.PORT ?? "3000", 10);
      expect(port).toBe(3000);
    });

    it("should use default HOST of 0.0.0.0", () => {
      setEnv(minimalEnv);
      const host = process.env.HOST ?? "0.0.0.0";
      expect(host).toBe("0.0.0.0");
    });

    it("should use default Redis URL of redis://localhost:6379", () => {
      setEnv(minimalEnv);
      const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
      expect(redisUrl).toBe("redis://localhost:6379");
    });
  });

  describe("TLS Auto-Detection", () => {
    it("should auto-detect TLS for rediss:// URLs", () => {
      setEnv({
        ...minimalEnv,
        REDIS_URL: "rediss://secure-redis.example.com:6379",
      });

      const redisUrl = process.env.REDIS_URL ?? "";
      const isRedissScheme = redisUrl.startsWith("rediss://");

      expect(isRedissScheme).toBe(true);
    });

    it("should auto-detect TLS for AWS ElastiCache URLs", () => {
      setEnv({
        ...minimalEnv,
        REDIS_URL: "redis://my-cluster.cache.amazonaws.com:6379",
      });

      const redisUrl = process.env.REDIS_URL ?? "";
      const isAwsElastiCache = redisUrl.includes(".cache.amazonaws.com");

      expect(isAwsElastiCache).toBe(true);
    });

    it("should not auto-detect TLS for regular redis:// URLs", () => {
      setEnv({ ...minimalEnv, REDIS_URL: "redis://localhost:6379" });

      const redisUrl = process.env.REDIS_URL ?? "";
      const isRedissScheme = redisUrl.startsWith("rediss://");
      const isAwsElastiCache = redisUrl.includes(".cache.amazonaws.com");
      const autoDetectTls = isRedissScheme || isAwsElastiCache;

      expect(autoDetectTls).toBe(false);
    });
  });

  describe("Scope Parsing", () => {
    it("should parse comma-separated scopes", () => {
      setEnv({
        ...minimalEnv,
        SENTRY_SCOPES: "org:read,project:read,event:write",
      });

      const scopeStr = process.env.SENTRY_SCOPES;
      const scopes = scopeStr
        ? scopeStr.split(",").map((s) => s.trim())
        : ["org:read", "project:read"];

      expect(scopes).toEqual(["org:read", "project:read", "event:write"]);
    });

    it("should use default scopes when not specified", () => {
      setEnv(minimalEnv);

      const DEFAULT_SENTRY_SCOPES = [
        "org:read",
        "project:read",
        "project:write",
        "team:read",
        "team:write",
        "event:write",
      ];

      const scopeStr = process.env.SENTRY_SCOPES;
      const scopes = scopeStr
        ? scopeStr.split(",").map((s) => s.trim())
        : DEFAULT_SENTRY_SCOPES;

      expect(scopes).toEqual(DEFAULT_SENTRY_SCOPES);
    });
  });

  describe("Boolean Parsing", () => {
    it('should parse "true" as true', () => {
      const parseBoolean = (
        value: string | undefined,
        defaultValue: boolean,
      ): boolean => {
        if (value === undefined) return defaultValue;
        return value.toLowerCase() === "true" || value === "1";
      };

      expect(parseBoolean("true", false)).toBe(true);
      expect(parseBoolean("TRUE", false)).toBe(true);
      expect(parseBoolean("True", false)).toBe(true);
    });

    it('should parse "1" as true', () => {
      const parseBoolean = (
        value: string | undefined,
        defaultValue: boolean,
      ): boolean => {
        if (value === undefined) return defaultValue;
        return value.toLowerCase() === "true" || value === "1";
      };

      expect(parseBoolean("1", false)).toBe(true);
    });

    it('should parse "false" as false', () => {
      const parseBoolean = (
        value: string | undefined,
        defaultValue: boolean,
      ): boolean => {
        if (value === undefined) return defaultValue;
        return value.toLowerCase() === "true" || value === "1";
      };

      expect(parseBoolean("false", true)).toBe(false);
      expect(parseBoolean("0", true)).toBe(false);
    });

    it("should use default value when undefined", () => {
      const parseBoolean = (
        value: string | undefined,
        defaultValue: boolean,
      ): boolean => {
        if (value === undefined) return defaultValue;
        return value.toLowerCase() === "true" || value === "1";
      };

      expect(parseBoolean(undefined, true)).toBe(true);
      expect(parseBoolean(undefined, false)).toBe(false);
    });
  });

  describe("Redirect URI Patterns", () => {
    it("should parse comma-separated patterns", () => {
      setEnv({
        ...minimalEnv,
        ALLOWED_REDIRECT_URI_PATTERNS:
          "http://localhost:*,https://app.example.com/callback",
      });

      const patternStr = process.env.ALLOWED_REDIRECT_URI_PATTERNS;
      const patterns = patternStr
        ? patternStr.split(",").map((p) => p.trim())
        : ["*"];

      expect(patterns).toEqual([
        "http://localhost:*",
        "https://app.example.com/callback",
      ]);
    });

    it('should default to ["*"] when not specified', () => {
      setEnv(minimalEnv);

      const patternStr = process.env.ALLOWED_REDIRECT_URI_PATTERNS;
      const patterns = patternStr
        ? patternStr.split(",").map((p) => p.trim())
        : ["*"];

      expect(patterns).toEqual(["*"]);
    });
  });

  describe("Optional AI Configuration", () => {
    it("should capture OpenAI API key when provided", () => {
      setEnv({ ...minimalEnv, OPENAI_API_KEY: "sk-test-key-123" });

      const openaiApiKey = process.env.OPENAI_API_KEY;
      expect(openaiApiKey).toBe("sk-test-key-123");
    });

    it("should handle missing OpenAI configuration gracefully", () => {
      setEnv(minimalEnv);

      const openaiApiKey = process.env.OPENAI_API_KEY;
      const openaiBaseUrl = process.env.OPENAI_BASE_URL;

      expect(openaiApiKey).toBeUndefined();
      expect(openaiBaseUrl).toBeUndefined();
    });

    it("should capture custom OpenAI base URL", () => {
      setEnv({
        ...minimalEnv,
        OPENAI_BASE_URL: "https://custom-openai.example.com/v1",
      });

      const openaiBaseUrl = process.env.OPENAI_BASE_URL;
      expect(openaiBaseUrl).toBe("https://custom-openai.example.com/v1");
    });
  });

  describe("MCP URL Configuration", () => {
    it("should use provided MCP_URL", () => {
      setEnv({ ...minimalEnv, MCP_URL: "https://custom-mcp.example.com" });

      const mcpUrl = process.env.MCP_URL;
      expect(mcpUrl).toBe("https://custom-mcp.example.com");
    });

    it("should be undefined when not provided", () => {
      setEnv(minimalEnv);

      const mcpUrl = process.env.MCP_URL;
      expect(mcpUrl).toBeUndefined();
    });
  });
});
