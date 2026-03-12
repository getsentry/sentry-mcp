import {
  getSentryCliDbPath,
  normalizeAccessToken,
  readAccessTokenFromSentryCliDb,
  type SentryCliAccessTokenSource,
} from "@sentry/mcp-core/internal/sentry-cli-auth";

export type AccessTokenSource = "flag-or-env" | SentryCliAccessTokenSource;

export type ResolvedAccessToken = {
  accessToken?: string;
  source?: AccessTokenSource;
};

export function getCliDbPath(homeDir?: string): string {
  return getSentryCliDbPath(homeDir);
}

export function resolveAccessToken({
  accessToken,
  nowMs = Date.now(),
  homeDir,
}: {
  accessToken?: string;
  nowMs?: number;
  homeDir?: string;
}): ResolvedAccessToken {
  const normalizedAccessToken = normalizeAccessToken(accessToken);
  if (normalizedAccessToken) {
    return {
      accessToken: normalizedAccessToken,
      source: "flag-or-env",
    };
  }

  const cliDbToken = readAccessTokenFromSentryCliDb({ nowMs, homeDir });
  if (cliDbToken) {
    return {
      accessToken: cliDbToken,
      source: "sentry_cli_db",
    };
  }

  return {};
}
