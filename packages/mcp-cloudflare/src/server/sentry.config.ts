import type { Env } from "./types";
import { LIB_VERSION } from "@sentry/mcp-server/version";
import * as Sentry from "@sentry/cloudflare";

type SentryConfig = ReturnType<Parameters<typeof Sentry.withSentry>[0]>;

export default function getSentryConfig(env: Env): SentryConfig {
  const { id: versionId } = env.CF_VERSION_METADATA;

  return {
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 1,
    sendDefaultPii: true,
    initialScope: {
      tags: {
        "mcp.server_version": LIB_VERSION,
        "sentry.host": env.SENTRY_HOST,
      },
    },
    release: versionId,
    environment:
      env.SENTRY_ENVIRONMENT ??
      (process.env.NODE_ENV !== "production" ? "development" : "production"),
    _experiments: {
      enableLogs: true,
    },
    integrations: [
      Sentry.consoleLoggingIntegration(),
      Sentry.zodErrorsIntegration(),
      Sentry.vercelAIIntegration(),
    ],
  };
}

getSentryConfig.partial = (config: Partial<SentryConfig>) => {
  return (env: Env) => {
    const defaultConfig = getSentryConfig(env);
    return {
      ...defaultConfig,
      ...config,
      initialScope: {
        ...defaultConfig.initialScope,
        ...config.initialScope,
        tags: {
          // idk I can't typescript
          ...((defaultConfig.initialScope ?? {}) as any).tags,
          ...((config.initialScope ?? {}) as any).tags,
        },
      },
    };
  };
};
