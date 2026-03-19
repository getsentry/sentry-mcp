import * as Sentry from "@sentry/cloudflare";

export type RateLimitScope = "ip" | "user";

type TrackedRoute = {
  group: "mcp" | "oauth" | "chat" | "search";
  route: string;
};

const RESPONSE_METRIC_NAME = "mcp.server.response";
const RATE_LIMIT_METRIC_NAME = "mcp.server.rate_limited";

export function classifyTrackedRoute(pathname: string): TrackedRoute | null {
  if (pathname.startsWith("/mcp")) {
    return {
      group: "mcp",
      route: "/mcp/:organizationSlug?/:projectSlug?",
    };
  }

  if (pathname.startsWith("/oauth/")) {
    return {
      group: "oauth",
      route: pathname,
    };
  }

  if (pathname.startsWith("/api/auth/")) {
    return {
      group: "oauth",
      route: "/api/auth/:action",
    };
  }

  if (pathname === "/api/chat") {
    return {
      group: "chat",
      route: pathname,
    };
  }

  if (pathname === "/api/search") {
    return {
      group: "search",
      route: pathname,
    };
  }

  return null;
}

function getStatusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

function getMetricAttributes(
  request: Request,
): Record<string, string | number> | null {
  const trackedRoute = classifyTrackedRoute(new URL(request.url).pathname);

  if (!trackedRoute) {
    return null;
  }

  return {
    "http.request.method": request.method,
    "http.route": trackedRoute.route,
    "sentry.route.group": trackedRoute.group,
  };
}

export function recordResponseMetric(
  request: Request,
  response: Response,
): void {
  const attributes = getMetricAttributes(request);

  if (!attributes) {
    return;
  }

  Sentry.metrics.count(RESPONSE_METRIC_NAME, 1, {
    attributes: {
      ...attributes,
      "http.response.status_code": response.status,
      "http.status_class": getStatusClass(response.status),
    },
  });
}

export function recordRateLimitedMetric(
  request: Request,
  rateLimitScope: RateLimitScope,
): void {
  const attributes = getMetricAttributes(request);

  if (!attributes) {
    return;
  }

  Sentry.metrics.count(RATE_LIMIT_METRIC_NAME, 1, {
    attributes: {
      ...attributes,
      "http.response.status_code": 429,
      "http.status_class": "4xx",
      "sentry.rate_limit.scope": rateLimitScope,
    },
  });
}
