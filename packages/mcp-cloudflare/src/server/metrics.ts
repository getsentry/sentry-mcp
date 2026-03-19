import * as Sentry from "@sentry/cloudflare";

export type RateLimitScope = "ip" | "user";
type ResponseReason = "local_rate_limit";

type TrackedRoute = {
  group: "mcp" | "oauth" | "chat" | "search";
  route: string;
};

const RESPONSE_METRIC_NAME = "mcp.server.response";

type ResponseMetricOptions = {
  rateLimitScope?: RateLimitScope;
  responseReason?: ResponseReason;
};

function isRoutePrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function normalizeOAuthRoute(pathname: string): string {
  switch (pathname) {
    case "/oauth/authorize":
    case "/oauth/callback":
    case "/oauth/token":
    case "/oauth/register":
      return pathname;
    default:
      return "/oauth/:action";
  }
}

export function classifyTrackedRoute(pathname: string): TrackedRoute | null {
  if (isRoutePrefix(pathname, "/mcp")) {
    return {
      group: "mcp",
      route: "/mcp/:organizationSlug?/:projectSlug?",
    };
  }

  if (isRoutePrefix(pathname, "/oauth")) {
    return {
      group: "oauth",
      route: normalizeOAuthRoute(pathname),
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
  options?: ResponseMetricOptions,
): void {
  const attributes = getMetricAttributes(request);

  if (!attributes) {
    return;
  }

  const responseAttributes: Record<string, string | number> = {
    "http.response.status_code": response.status,
    "http.status_class": getStatusClass(response.status),
  };

  if (options?.responseReason) {
    responseAttributes["sentry.response.reason"] = options.responseReason;
  }

  if (options?.rateLimitScope) {
    responseAttributes["sentry.rate_limit.scope"] = options.rateLimitScope;
  }

  Sentry.metrics.count(RESPONSE_METRIC_NAME, 1, {
    attributes: {
      ...attributes,
      ...responseAttributes,
    },
  });
}
