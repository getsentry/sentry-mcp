import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveAccessToken } from "./resolve-token";
import type { PartiallyResolvedConfig } from "../cli/types";

// Mock the auth modules so we never make real network calls or touch disk
vi.mock("./device-code-flow", () => ({
  authenticate: vi.fn(),
}));

vi.mock("./token-cache", () => ({
  readCachedToken: vi.fn().mockResolvedValue(null),
  writeCachedToken: vi.fn().mockResolvedValue(undefined),
}));

function makePartialConfig(
  overrides: Partial<PartiallyResolvedConfig> = {},
): PartiallyResolvedConfig {
  return {
    clientId: "test-client-id",
    sentryHost: "sentry.io",
    finalSkills: new Set(),
    ...overrides,
  };
}

describe("resolveAccessToken", () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    originalIsTTY = process.stderr.isTTY;
  });

  afterEach(() => {
    Object.defineProperty(process.stderr, "isTTY", {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("returns immediately when accessToken is provided", async () => {
    const cfg = makePartialConfig({ accessToken: "existing-token" });
    const result = await resolveAccessToken(cfg);
    expect(result.accessToken).toBe("existing-token");
  });

  it("throws for non-sentry.io hosts without a token", async () => {
    const cfg = makePartialConfig({
      sentryHost: "sentry.example.com",
    });
    await expect(resolveAccessToken(cfg)).rejects.toThrow(
      /only supported for sentry.io/,
    );
  });

  it("throws in non-TTY context when no token and no cache", async () => {
    Object.defineProperty(process.stderr, "isTTY", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const cfg = makePartialConfig();
    await expect(resolveAccessToken(cfg)).rejects.toThrow(
      /Run `sentry-mcp auth login` interactively first/,
    );
  });

  it("uses cached token in non-TTY context", async () => {
    Object.defineProperty(process.stderr, "isTTY", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const { readCachedToken } = await import("./token-cache");
    vi.mocked(readCachedToken).mockResolvedValueOnce({
      access_token: "cached-token",
      refresh_token: "refresh",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      sentry_host: "sentry.io",
      client_id: "test-client-id",
      user_email: "test@example.com",
      scope: "org:read",
    });

    const cfg = makePartialConfig();
    const result = await resolveAccessToken(cfg);
    expect(result.accessToken).toBe("cached-token");
  });

  it("triggers device code flow in TTY context when no cache", async () => {
    Object.defineProperty(process.stderr, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });

    const { authenticate } = await import("./device-code-flow");
    vi.mocked(authenticate).mockResolvedValueOnce({
      access_token: "new-token",
      refresh_token: "refresh",
      token_type: "bearer",
      expires_in: 2592000,
      expires_at: new Date(Date.now() + 2592000000).toISOString(),
      user: { email: "test@example.com", id: "1", name: "Test" },
      scope: "org:read",
    });

    const cfg = makePartialConfig();
    const result = await resolveAccessToken(cfg);
    expect(result.accessToken).toBe("new-token");
    expect(authenticate).toHaveBeenCalledWith({
      clientId: "test-client-id",
      host: "sentry.io",
    });
  });

  it("accepts regional sentry.io subdomains", async () => {
    Object.defineProperty(process.stderr, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });

    const { authenticate } = await import("./device-code-flow");
    vi.mocked(authenticate).mockResolvedValueOnce({
      access_token: "regional-token",
      refresh_token: "refresh",
      token_type: "bearer",
      expires_in: 2592000,
      expires_at: new Date(Date.now() + 2592000000).toISOString(),
      user: { email: "test@example.com", id: "1", name: "Test" },
      scope: "org:read",
    });

    const cfg = makePartialConfig({ sentryHost: "us.sentry.io" });
    const result = await resolveAccessToken(cfg);
    expect(result.accessToken).toBe("regional-token");
    // OAuth endpoints always use sentry.io, not the regional subdomain
    expect(authenticate).toHaveBeenCalledWith({
      clientId: "test-client-id",
      host: "sentry.io",
    });
  });
});
