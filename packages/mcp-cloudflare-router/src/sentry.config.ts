import type { Env } from "./types";
import { LIB_VERSION } from "@sentry/mcp-core/version";
import * as Sentry from "@sentry/cloudflare";
import { sentryBeforeSend } from "@sentry/mcp-core/telem/sentry";

type SentryConfig = ReturnType<Parameters<typeof Sentry.withSentry>[0]>;

export default function getSentryConfig(env: Env): SentryConfig {
  const { id: versionId } = env.CF_VERSION_METADATA;

  return {
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 1,
    sendDefaultPii: true,
    beforeSend: sentryBeforeSend,
    initialScope: {
      tags: {
        "mcp.server_version": LIB_VERSION,
        "sentry.host": env.SENTRY_HOST,
        "worker.name": "router",
      },
    },
    release: versionId,
    environment: env.SENTRY_ENVIRONMENT ?? "production",
    enableLogs: true,
    integrations: [
      Sentry.consoleLoggingIntegration(),
      Sentry.zodErrorsIntegration(),
    ],
  };
}
