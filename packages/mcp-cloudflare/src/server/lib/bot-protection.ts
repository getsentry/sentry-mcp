import type { Env } from "../types";
import type { IncomingRequestCfProperties } from "@cloudflare/workers-types";

const GENERIC_BOT_USER_AGENTS = [
  // Python HTTP clients
  "python-requests",
  "python-httpx",
  "python-urllib",
  "aiohttp",
  "httpcore",

  // Go HTTP clients
  "go-http-client",

  // Java/Android HTTP clients
  "okhttp",
  "apache-httpclient",
  "java",

  // Node.js HTTP clients
  "node-fetch",
  "axios",
  "got",
  "undici",

  // Command line tools
  "curl",
  "wget",
  "httpie",

  // Ruby HTTP clients
  "ruby",
  "faraday",

  // PHP HTTP clients
  "guzzlehttp",
  "php",

  // .NET HTTP clients
  "dotnet",

  // Other generic clients
  "libwww-perl",
  "lwp-trivial",
  "httpclient",
  "the http gem",
  "rest-client",

  // Generic patterns that indicate non-browser clients
  "bot",
  "spider",
  "crawler",
  "scraper",
  "monitor",
  "fetch",
];

const ALLOWED_BOT_USER_AGENTS = [
  // Search engines
  "googlebot",
  "bingbot",
  "slurp", // Yahoo
  "duckduckbot",
  "baiduspider",
  "yandexbot",

  // Social media
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "whatsapp",
  "telegrambot",

  // Development tools
  "postman",
  "insomnia",

  // Monitoring services
  "uptimerobot",
  "pingdom",
  "newrelic",
  "datadog",

  // Other legitimate services
  "github-camo", // GitHub image proxy
  "slack-imgproxy", // Slack image proxy
];

function isGenericBot(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();

  // First check if it's an allowed bot
  for (const allowed of ALLOWED_BOT_USER_AGENTS) {
    if (ua.includes(allowed)) {
      return false;
    }
  }

  // Then check if it's a generic bot
  for (const generic of GENERIC_BOT_USER_AGENTS) {
    if (ua.includes(generic)) {
      return true;
    }
  }

  // Check if it's missing a user agent or has a very short one
  if (!userAgent || userAgent.length < 10) {
    return true;
  }

  // Check for well-formed browser user agents
  // Most legitimate browsers have complex user agents with version numbers
  const hasBrowserIdentifiers =
    ua.includes("mozilla/") &&
    (ua.includes("gecko/") ||
      ua.includes("webkit/") ||
      ua.includes("chrome/") ||
      ua.includes("safari/"));

  return !hasBrowserIdentifiers;
}

export function withBotProtection<E extends Env = Env>(
  handler: ExportedHandler<E>,
): ExportedHandler<E> {
  return {
    ...handler,
    async fetch(
      request: Request<unknown, IncomingRequestCfProperties<unknown>>,
      env: E,
      ctx: ExecutionContext,
    ) {
      const userAgent = request.headers.get("user-agent") || "";

      // Check if this is a generic bot
      if (isGenericBot(userAgent)) {
        // Return 403 Forbidden for generic bots
        return new Response("Access denied", {
          status: 403,
          headers: {
            "content-type": "text/plain",
          },
        });
      }

      // If not a generic bot, pass through to the handler
      if (handler.fetch) {
        return handler.fetch(request, env, ctx);
      }

      // Default response if no fetch handler
      return new Response("Not implemented", { status: 501 });
    },
  };
}
