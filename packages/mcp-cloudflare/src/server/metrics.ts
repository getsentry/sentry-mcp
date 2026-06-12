import * as Sentry from "@sentry/cloudflare";
import { resolveClientFamily } from "./lib/client-family";
import type { OAuthErrorTelemetry } from "./oauth/telemetry";

export type RateLimitScope = "ip" | "user";
type ResponseReason = "local_rate_limit";

type TrackedRoute = {
  group: "mcp" | "oauth" | "chat" | "search";
  route: string;
};

const RESPONSE_METRIC_NAME = "app.server.response";
const RESPONSE_REASON_HEADER = "x-sentry-response-reason";
const RATE_LIMIT_SCOPE_HEADER = "x-sentry-rate-limit-scope";

type ResponseMetricOptions = {
  rateLimitScope?: RateLimitScope;
  responseReason?: ResponseReason;
} & OAuthErrorTelemetry;

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

function getBooleanAttribute(value: boolean): string {
  return value ? "true" : "false";
}

function getMcpRequestAttributes(request: Request, url: URL) {
  return {
    clientFamily: resolveClientFamily(request.headers.get("user-agent")),
    agentMode: url.searchParams.get("agent") === "1",
    experimentalMode: url.searchParams.get("experimental") === "1",
  };
}

function shouldAttachClientFamily(trackedRoute: TrackedRoute): boolean {
  return (
    trackedRoute.group === "mcp" ||
    trackedRoute.route === "/oauth/token" ||
    trackedRoute.route === "/oauth/register"
  );
}

function getMetricAttributes(
  request: Request,
): Record<string, string | number> | null {
  if (request.method === "OPTIONS") {
    return null;
  }

  const url = new URL(request.url);
  const trackedRoute = classifyTrackedRoute(url.pathname);

  if (!trackedRoute) {
    return null;
  }

  const attributes: Record<string, string | number> = {
    "http.request.method": request.method,
    "http.route": trackedRoute.route,
    "app.route.group": trackedRoute.group,
  };

  if (shouldAttachClientFamily(trackedRoute)) {
    attributes["app.client.family"] = resolveClientFamily(
      request.headers.get("user-agent"),
    );
  }

  if (trackedRoute.group === "mcp") {
    const mcpAttributes = getMcpRequestAttributes(request, url);
    attributes["app.server.mode.agent"] = getBooleanAttribute(
      mcpAttributes.agentMode,
    );
    attributes["app.server.mode.experimental"] = getBooleanAttribute(
      mcpAttributes.experimentalMode,
    );
  }

  return attributes;
}

/**
 * Annotates the active Sentry span with the same route/response attributes
 * used by `app.server.response` metrics.
 */
export function annotateTrackedRequestSpan(
  request: Request,
  url: URL,
  response: Response,
  options?: ResponseMetricOptions,
): void {
  if (request.method === "OPTIONS") {
    return;
  }

  const trackedRoute = classifyTrackedRoute(url.pathname);
  if (!trackedRoute) {
    return;
  }

  const activeSpan = Sentry.getActiveSpan();
  if (!activeSpan) {
    return;
  }

  activeSpan.setAttribute("http.route", trackedRoute.route);
  activeSpan.setAttribute("app.route.group", trackedRoute.group);
  activeSpan.setAttribute("http.response.status_code", response.status);
  activeSpan.setAttribute(
    "app.response.status_class",
    getStatusClass(response.status),
  );

  if (shouldAttachClientFamily(trackedRoute)) {
    activeSpan.setAttribute(
      "app.client.family",
      resolveClientFamily(request.headers.get("user-agent")),
    );
  }

  if (trackedRoute.group === "mcp") {
    const mcpAttributes = getMcpRequestAttributes(request, url);
    activeSpan.setAttribute("app.transport", "http");
    activeSpan.setAttribute("app.server.mode.agent", mcpAttributes.agentMode);
    activeSpan.setAttribute(
      "app.server.mode.experimental",
      mcpAttributes.experimentalMode,
    );
  }

  if (options?.responseReason) {
    activeSpan.setAttribute("app.response.reason", options.responseReason);
  }

  if (options?.rateLimitScope) {
    activeSpan.setAttribute("app.rate_limit.scope", options.rateLimitScope);
  }

  if (options?.oauthError) {
    activeSpan.setAttribute("app.oauth.error", options.oauthError);
  }

  if (options?.oauthErrorDescription) {
    activeSpan.setAttribute(
      "app.oauth.error_description",
      options.oauthErrorDescription,
    );
  }

  if (options?.oauthTokenShape) {
    activeSpan.setAttribute(
      "app.oauth.request.token_shape",
      options.oauthTokenShape,
    );
  }
}

export function annotateResponseMetric(
  response: Response,
  options: ResponseMetricOptions,
): Response {
  if (!options.responseReason && !options.rateLimitScope) {
    return response;
  }

  const annotatedResponse = new Response(response.body, response);

  if (options.responseReason) {
    annotatedResponse.headers.set(
      RESPONSE_REASON_HEADER,
      options.responseReason,
    );
  }

  if (options.rateLimitScope) {
    annotatedResponse.headers.set(
      RATE_LIMIT_SCOPE_HEADER,
      options.rateLimitScope,
    );
  }

  return annotatedResponse;
}

export function extractResponseMetricOptions(
  response: Response,
): ResponseMetricOptions {
  const responseReason = response.headers.get(RESPONSE_REASON_HEADER);
  const rateLimitScope = response.headers.get(RATE_LIMIT_SCOPE_HEADER);

  return {
    responseReason:
      responseReason === "local_rate_limit" ? responseReason : undefined,
    rateLimitScope:
      rateLimitScope === "ip" || rateLimitScope === "user"
        ? rateLimitScope
        : undefined,
  };
}

export function stripResponseMetricHeaders(response: Response): Response {
  if (
    !response.headers.has(RESPONSE_REASON_HEADER) &&
    !response.headers.has(RATE_LIMIT_SCOPE_HEADER)
  ) {
    return response;
  }

  const sanitizedResponse = new Response(response.body, response);
  sanitizedResponse.headers.delete(RESPONSE_REASON_HEADER);
  sanitizedResponse.headers.delete(RATE_LIMIT_SCOPE_HEADER);
  return sanitizedResponse;
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
    "app.response.status_class": getStatusClass(response.status),
  };

  if (options?.responseReason) {
    responseAttributes["app.response.reason"] = options.responseReason;
  }

  if (options?.rateLimitScope) {
    responseAttributes["app.rate_limit.scope"] = options.rateLimitScope;
  }

  if (options?.oauthError) {
    responseAttributes["app.oauth.error"] = options.oauthError;
  }

  if (options?.oauthErrorDescription) {
    responseAttributes["app.oauth.error_description"] =
      options.oauthErrorDescription;
  }

  if (options?.oauthTokenShape) {
    responseAttributes["app.oauth.request.token_shape"] =
      options.oauthTokenShape;
  }

  Sentry.metrics.count(RESPONSE_METRIC_NAME, 1, {
    attributes: {
      ...attributes,
      ...responseAttributes,
    },
  });
}
