import * as Sentry from "@sentry/react";
import { sentryBeforeSend } from "./utils/sentry-scrubbing";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  sendDefaultPii: true,
  tracesSampleRate: 1,
  beforeSend: sentryBeforeSend,
  enableLogs: true,
  integrations: [Sentry.consoleLoggingIntegration()],
  environment:
    import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.NODE_ENV,
});
