import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLocalAuth, resolveSentryHost } from "./stdio-auth.js";

function createCliDb({
  token,
  expiresAt,
}: {
  token?: string | null;
  expiresAt?: number | null;
}) {
  const homeDir = mkdtempSync(join(tmpdir(), "sentry-mcp-client-auth-"));
  const configDir = join(homeDir, ".sentry");
  mkdirSync(configDir);
  const dbPath = join(configDir, "cli.db");
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      token TEXT,
      refresh_token TEXT,
      expires_at INTEGER,
      issued_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);

  db.prepare("INSERT INTO auth (id, token, expires_at) VALUES (1, ?, ?)").run(
    token ?? null,
    expiresAt ?? null,
  );
  db.close();

  return homeDir;
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("resolveSentryHost", () => {
  it("falls back to SENTRY_HOST", () => {
    expect(
      resolveSentryHost({
        SENTRY_HOST: "sentry.example.com",
      }),
    ).toBe("sentry.example.com");
  });
});

describe("resolveLocalAuth", () => {
  it("uses cli.db when explicit token is missing", () => {
    const nowMs = Date.now();
    const configDir = createCliDb({
      token: "db-token",
      expiresAt: nowMs + 10 * 60_000,
    });
    tempDirs.push(configDir);

    const result = resolveLocalAuth({
      env: {
        SENTRY_HOST: "sentry.example.com",
      },
      nowMs,
      homeDir: configDir,
    });

    expect(result).toEqual({
      accessToken: "db-token",
      accessTokenSource: "sentry_cli_db",
      host: "sentry.example.com",
    });
  });

  it("stays in remote mode when cli.db token is expired", () => {
    const nowMs = Date.now();
    const configDir = createCliDb({
      token: "db-token",
      expiresAt: nowMs + 4 * 60_000,
    });
    tempDirs.push(configDir);

    const result = resolveLocalAuth({
      env: {
        SENTRY_HOST: "sentry.example.com",
      },
      nowMs,
      homeDir: configDir,
    });

    expect(result).toEqual({});
  });

  it("ignores unreadable cli.db state", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "sentry-mcp-client-auth-"));
    const configDir = join(homeDir, ".sentry");
    mkdirSync(configDir);
    tempDirs.push(homeDir);
    writeFileSync(join(configDir, "cli.db"), "not-a-sqlite-db");

    const result = resolveLocalAuth({
      env: {},
      homeDir,
    });

    expect(result).toEqual({});
  });
});
