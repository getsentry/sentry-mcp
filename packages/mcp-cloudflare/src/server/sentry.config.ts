import type { Env } from "./types";
import { LIB_VERSION } from "@sentry/mcp-server/version";
import * as Sentry from "@sentry/cloudflare";

type SentryConfig = ReturnType<Parameters<typeof Sentry.withSentry>[0]>;

export default function getSentryConfig(env: Env): SentryConfig {
  return {
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 1,
    sendDefaultPii: true,
    initialScope: {
      tags: {
        durable_object: true,
        mcp_server_version: LIB_VERSION,
      },
    },
    environment:
      env.SENTRY_ENVIRONMENT ??
      (process.env.NODE_ENV !== "production" ? "development" : "production"),
    _experiments: {
      enableLogs: true,
    },
    integrations: [Sentry.consoleLoggingIntegration()],
  };
}

getSentryConfig.partial = (config: Partial<SentryConfig>) => {
  return (env: Env) => ({
    ...getSentryConfig(env),
    ...config,
  });
};
