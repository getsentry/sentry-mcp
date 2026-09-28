// Server-side attribution helpers. These live separately from client-side
// attribution (client/utils/attribution.ts) because the two contexts have
// different known utm_source values and different APIs (no window/document
// on the server).

/**
 * Span/metric attribute name for the bucketed utm_source value.
 * Use this constant in all call sites to avoid drift.
 */
export const UTM_SOURCE_ATTRIBUTE = "app.utm_source";

/**
 * HTTP header used by MCP clients (e.g. the Claude plugin) to pass attribution
 * without folding it into the OAuth resource URL / RFC 8707 resource indicator.
 *
 * Prefer this over `?utm_source=` when the client supports custom headers.
 */
export const UTM_SOURCE_HEADER = "X-Sentry-Utm-Source";

/**
 * Buckets a raw utm_source value into a fixed allow-list so it is safe to use
 * as a metric/span attribute (raw values are unbounded cardinality). Returns
 * null when the value is absent so callers can skip setting the attribute
 * entirely — absence means "no UTM source", which is different from "unknown
 * UTM source".
 *
 * Known server-side values:
 *   "plugin" — MCP traffic tagged by a sentry-for-ai AI plugin
 */
export function resolveUtmSource(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  switch (raw) {
    case "plugin":
      return raw;
    default:
      return "other";
  }
}

/**
 * Convenience wrapper that reads utm_source from URL search params.
 */
export function resolveUtmSourceFromUrl(url: URL): string | null {
  return resolveUtmSource(url.searchParams.get("utm_source"));
}

/**
 * Resolve utm_source for an MCP request.
 *
 * Prefer the dedicated attribution header so clients can keep the MCP resource
 * URL free of query params (important for OAuth resource indicators). Fall back
 * to `?utm_source=` for existing plugin configs that still tag the URL.
 */
export function resolveUtmSourceFromRequest(
  request: Request,
  url: URL = new URL(request.url),
): string | null {
  const fromHeader = resolveUtmSource(request.headers.get(UTM_SOURCE_HEADER));
  if (fromHeader) {
    return fromHeader;
  }
  return resolveUtmSourceFromUrl(url);
}
