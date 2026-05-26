import type { spanToJSON } from "@sentry/react";

export function resolveUtmSource(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  return raw === "sentry-mcp-settings-docs-btn" ? raw : "other";
}

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

type SpanJSON = ReturnType<typeof spanToJSON>;

export function attributionBeforeSendSpan(span: SpanJSON): SpanJSON {
  if (span.op !== "pageload") return span;

  const utmSource = resolveUtmSource(
    new URLSearchParams(window.location.search).get("utm_source"),
  );
  const referrerFamily = resolveReferrerFamily(document.referrer);

  span.data = {
    ...span.data,
    ...(utmSource && { "app.utm_source": utmSource }),
    ...(referrerFamily && { "app.referrer.family": referrerFamily }),
  };
  return span;
}
