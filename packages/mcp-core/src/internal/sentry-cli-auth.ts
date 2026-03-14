import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export type SentryCliAccessTokenSource = "sentry_cli_db";

type AuthRow = {
  token: string | null;
  expires_at: number | null;
};

export function normalizeAccessToken(
  token?: string | null,
): string | undefined {
  const trimmed = token?.trim();
  return trimmed ? trimmed : undefined;
}

export function getSentryCliDbPath(homeDir = homedir()): string {
  return join(homeDir, ".sentry", "cli.db");
}

export function readAccessTokenFromSentryCliDb({
  nowMs,
  homeDir,
}: {
  nowMs: number;
  homeDir?: string;
}): string | undefined {
  const cliDbPath = getSentryCliDbPath(homeDir);

  try {
    const db = new Database(cliDbPath, {
      readonly: true,
      fileMustExist: true,
    });

    try {
      const row = db
        .prepare("SELECT token, expires_at FROM auth WHERE id = 1")
        .get() as AuthRow | undefined;
      const token = normalizeAccessToken(row?.token);

      if (!token) {
        return undefined;
      }

      if (
        typeof row?.expires_at === "number" &&
        nowMs + TOKEN_EXPIRY_BUFFER_MS >= row.expires_at
      ) {
        return undefined;
      }

      return token;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}
