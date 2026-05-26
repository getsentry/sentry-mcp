// Buckets the `Referer` header host into a low-cardinality "family" for
// span attribution. Unknown hosts collapse to "other"; missing/same-origin
// referers return null so they're not stamped on the span.
const FAMILY_BY_HOST: Array<[RegExp, string]> = [
  [/^docs\.sentry\.io$/, "sentry-docs"],
  [/(^|\.)sentry\.io$/, "sentry"],
  [/(^|\.)github\.com$/, "github"],
  [/(^|\.)google\.[a-z.]+$/, "google"],
];

export function resolveReferrerFamily(
  referer: string | null | undefined,
): string | null {
  if (!referer) return null;
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (host === "mcp.sentry.dev") return null;
  for (const [pattern, family] of FAMILY_BY_HOST) {
    if (pattern.test(host)) return family;
  }
  return "other";
}
