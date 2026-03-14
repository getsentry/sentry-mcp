import {
  normalizeAccessToken,
  readAccessTokenFromSentryCliDb,
  type SentryCliAccessTokenSource,
} from "@sentry/mcp-core/internal/sentry-cli-auth";
import { validateSentryHostThrows } from "@sentry/mcp-core/utils/url-utils";

export type AccessTokenSource = "flag-or-env" | SentryCliAccessTokenSource;

export type ResolvedLocalAuth = {
  accessToken?: string;
  accessTokenSource?: AccessTokenSource;
  host?: string;
};

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
  const normalizedAccessToken = normalizeAccessToken(accessToken);
  if (normalizedAccessToken) {
    return {
      accessToken: normalizedAccessToken,
      accessTokenSource: "flag-or-env",
      host: resolveSentryHost(env),
    };
  }

  const cliDbToken = readAccessTokenFromSentryCliDb({ nowMs, homeDir });
  if (cliDbToken) {
    return {
      accessToken: cliDbToken,
      accessTokenSource: "sentry_cli_db",
      host: resolveSentryHost(env),
    };
  }

  return {};
}
