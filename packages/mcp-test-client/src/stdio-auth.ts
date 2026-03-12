import Database from "better-sqlite3";
import * as os from "node:os";
import { join } from "node:path";
import { validateSentryHostThrows } from "@sentry/mcp-core/utils/url-utils";

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export type AccessTokenSource = "flag-or-env" | "sentry_cli_db";

export type ResolvedLocalAuth = {
  accessToken?: string;
  accessTokenSource?: AccessTokenSource;
  host?: string;
};

type AuthRow = {
  token: string | null;
  expires_at: number | null;
};

function normalizeToken(token?: string | null): string | undefined {
  const trimmed = token?.trim();
  return trimmed ? trimmed : undefined;
}

function getCliDbPath(homeDir = os.homedir()): string {
  return join(homeDir, ".sentry", "cli.db");
}

function readTokenFromCliDb(
  nowMs: number,
  homeDir?: string,
): string | undefined {
  const cliDbPath = getCliDbPath(homeDir);

  try {
    const db = new Database(cliDbPath, {
      readonly: true,
      fileMustExist: true,
    });

    try {
      const row = db
        .prepare("SELECT token, expires_at FROM auth WHERE id = 1")
        .get() as AuthRow | undefined;
      const token = normalizeToken(row?.token);

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

export function resolveSentryHost(env: NodeJS.ProcessEnv): string | undefined {
  const sentryHost = env.SENTRY_HOST?.trim();
  if (sentryHost) {
    validateSentryHostThrows(sentryHost);
    return sentryHost;
  }

  return undefined;
}

export function resolveLocalAuth({
  accessToken,
  env,
  nowMs = Date.now(),
  homeDir,
}: {
  accessToken?: string;
  env: NodeJS.ProcessEnv;
  nowMs?: number;
  homeDir?: string;
}): ResolvedLocalAuth {
  const normalizedAccessToken = normalizeToken(accessToken);
  if (normalizedAccessToken) {
    return {
      accessToken: normalizedAccessToken,
      accessTokenSource: "flag-or-env",
      host: resolveSentryHost(env),
    };
  }

  const cliDbToken = readTokenFromCliDb(nowMs, homeDir);
  if (cliDbToken) {
    return {
      accessToken: cliDbToken,
      accessTokenSource: "sentry_cli_db",
      host: resolveSentryHost(env),
    };
  }

  return {};
}
