import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAccessToken } from "./auth";

function createCliDb({
  token,
  expiresAt,
}: {
  token?: string | null;
  expiresAt?: number | null;
}) {
  const homeDir = mkdtempSync(join(tmpdir(), "sentry-mcp-auth-"));
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

describe("resolveAccessToken", () => {
  it("prefers explicit access token over env and cli db", () => {
    const nowMs = Date.now();
    const configDir = createCliDb({
      token: "db-token",
      expiresAt: nowMs + 10 * 60_000,
    });
    tempDirs.push(configDir);

    const result = resolveAccessToken({
      accessToken: "flag-token",
      nowMs,
      homeDir: configDir,
    });

    expect(result).toEqual({
      accessToken: "flag-token",
      source: "flag-or-env",
    });
  });

  it("uses cli.db when explicit token is not provided", () => {
    const nowMs = Date.now();
    const configDir = createCliDb({
      token: "db-token",
      expiresAt: nowMs + 10 * 60_000,
    });
    tempDirs.push(configDir);

    const result = resolveAccessToken({
      nowMs,
      homeDir: configDir,
    });

    expect(result).toEqual({
      accessToken: "db-token",
      source: "sentry_cli_db",
    });
  });

  it("ignores expired cli.db tokens", () => {
    const nowMs = Date.now();
    const configDir = createCliDb({
      token: "db-token",
      expiresAt: nowMs + 4 * 60_000,
    });
    tempDirs.push(configDir);

    const result = resolveAccessToken({
      nowMs,
      homeDir: configDir,
    });

    expect(result).toEqual({});
  });

  it("ignores missing or unreadable cli.db state", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "sentry-mcp-auth-"));
    const configDir = join(homeDir, ".sentry");
    mkdirSync(configDir);
    tempDirs.push(homeDir);
    writeFileSync(join(configDir, "cli.db"), "not-a-sqlite-db");

    const result = resolveAccessToken({
      homeDir,
    });

    expect(result).toEqual({});
  });
});
