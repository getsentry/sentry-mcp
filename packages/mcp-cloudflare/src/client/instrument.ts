import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  sendDefaultPii: true,
  tracesSampleRate: 1,
  environment:
    import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.NODE_ENV,
});
