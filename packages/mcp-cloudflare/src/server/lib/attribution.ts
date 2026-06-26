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
 * Buckets a raw utm_source query param value into a fixed allow-list so it
 * is safe to use as a metric/span attribute (raw values are unbounded
 * cardinality). Returns null when the param is absent so callers can skip
 * setting the attribute entirely — absence means "no UTM source", which is
 * different from "unknown UTM source".
 *
 * Known server-side values:
 *   "plugin" — MCP server URL tagged by the sentry-for-ai AI plugin
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
 * Convenience wrapper that reads utm_source directly from a URL object.
 */
export function resolveUtmSourceFromUrl(url: URL): string | null {
  return resolveUtmSource(url.searchParams.get("utm_source"));
}
