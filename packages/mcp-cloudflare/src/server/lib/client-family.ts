// Bucket User-Agent into a fixed set of values so it's safe to use as a
// metric attribute (raw UAs are unbounded cardinality).
export function resolveClientFamily(
  userAgent: string | null | undefined,
): string {
  if (!userAgent) return "unknown";

  const ua = userAgent.toLowerCase();

  if (ua.startsWith("claude-code/")) return "claude-code";
  if (ua.startsWith("cursor/")) return "cursor";
  if (ua.startsWith("copilot/")) return "copilot";
  if (ua.startsWith("opencode/")) return "opencode";
  if (ua.startsWith("claude-user")) return "claude-desktop";
  if (ua.includes("codex")) return "codex";

  if (ua.startsWith("reactornetty/")) return "reactor-netty";
  if (ua.startsWith("java-http-client/")) return "java-http-client";
  if (ua.startsWith("go-http-client/")) return "go-http-client";
  if (
    ua.startsWith("python-httpx/") ||
    ua.startsWith("python/") ||
    ua.startsWith("aiohttp/")
  ) {
    return "python";
  }
  if (ua.startsWith("bun/")) return "bun";
  if (ua === "node" || ua.startsWith("node-fetch/")) return "node";

  return "other";
}
