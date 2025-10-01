import * as Sentry from "@sentry/react";
import { sentryBeforeSend } from "@sentry/mcp-server/telem/sentry";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  sendDefaultPii: true,
  tracesSampleRate: 1,
  beforeSend: sentryBeforeSend,
  environment:
    import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.NODE_ENV,
});
