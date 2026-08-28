import * as Sentry from "@sentry/react";
import { sentryBeforeSend } from "@sentry/mcp-core/telem/sentry";
import { resolveAttribution } from "./utils";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  sendDefaultPii: true,
  tracesSampleRate: 1,
  beforeSend: sentryBeforeSend,
  // Cloudflare Web Analytics injects beacon.min.js outside our HTML. On older
  // browsers (e.g. Mobile Safari 13) it throws TypeError: t.entries.at is not a
  // function. Plausible is loaded from index.html and is similarly third-party.
  denyUrls: ["static.cloudflareinsights.com", "plausible.io/js/"],
  environment:
    import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.NODE_ENV,
  integrations: [Sentry.browserTracingIntegration()],
});

resolveAttribution();
