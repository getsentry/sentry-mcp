export function sanitizeUtmSource(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  // Exact-match to keep cardinality bounded
  return raw === "sentry-mcp-settings-docs-btn" ? raw : "other";
}
