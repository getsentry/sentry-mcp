import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  readCachedToken,
  writeCachedToken,
  clearCachedToken,
} from "./token-cache";
import type { CachedToken } from "./types";

let tmpDir: string;

function makeCachedToken(overrides: Partial<CachedToken> = {}): CachedToken {
  return {
    access_token: "sntrys_test_token",
    refresh_token: "sntrys_refresh_token",
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    sentry_host: "sentry.io",
    client_id: "test-client-id",
    user_email: "user@example.com",
    scope: "org:read project:write team:write event:write",
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-auth-test-"));
  process.env.SENTRY_MCP_AUTH_CACHE = path.join(tmpDir, "mcp.json");
});

afterEach(async () => {
  process.env.SENTRY_MCP_AUTH_CACHE = undefined;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("token-cache", () => {
  it("returns null when no cache file exists", async () => {
    const result = await readCachedToken("sentry.io", "test-client-id");
    expect(result).toBeNull();
  });

  it("writes and reads a token", async () => {
    const token = makeCachedToken();
    await writeCachedToken(token);

    const result = await readCachedToken("sentry.io", "test-client-id");
    expect(result).toEqual(token);
  });

  it("returns null for a different host/clientId pair", async () => {
    await writeCachedToken(makeCachedToken());

    const result = await readCachedToken("other.sentry.io", "test-client-id");
    expect(result).toBeNull();
  });

  it("returns null and clears expired tokens", async () => {
    const expired = makeCachedToken({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    await writeCachedToken(expired);

    const result = await readCachedToken("sentry.io", "test-client-id");
    expect(result).toBeNull();

    // Verify it was cleared from the file
    const raw = await fs.readFile(process.env.SENTRY_MCP_AUTH_CACHE!, "utf-8");
    const data = JSON.parse(raw);
    expect(data["sentry.io:test-client-id"]).toBeUndefined();
  });

  it("returns null for tokens expiring within safety window", async () => {
    const almostExpired = makeCachedToken({
      // Expires in 2 minutes (within 5-minute safety window)
      expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    });
    await writeCachedToken(almostExpired);

    const result = await readCachedToken("sentry.io", "test-client-id");
    expect(result).toBeNull();
  });

  it("clears a specific token", async () => {
    await writeCachedToken(makeCachedToken());
    await writeCachedToken(
      makeCachedToken({
        sentry_host: "other.sentry.io",
        client_id: "other-id",
      }),
    );

    await clearCachedToken("sentry.io", "test-client-id");

    const cleared = await readCachedToken("sentry.io", "test-client-id");
    expect(cleared).toBeNull();

    // Other entry should still exist
    const other = await readCachedToken("other.sentry.io", "other-id");
    expect(other).not.toBeNull();
  });

  it("handles corrupted cache file gracefully", async () => {
    await fs.writeFile(process.env.SENTRY_MCP_AUTH_CACHE!, "not-json", "utf-8");

    const result = await readCachedToken("sentry.io", "test-client-id");
    expect(result).toBeNull();
  });

  it("sets restrictive file permissions", async () => {
    await writeCachedToken(makeCachedToken());

    const stat = await fs.stat(process.env.SENTRY_MCP_AUTH_CACHE!);
    // 0o600 = owner read/write only (on Unix-like systems)
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
