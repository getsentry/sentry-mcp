/**
 * Extract client IP address from request headers.
 *
 * Checks headers in priority order:
 * 1. CF-Connecting-IP (Cloudflare's most reliable header)
 * 2. X-Real-IP (common reverse proxy header)
 * 3. X-Forwarded-For (fallback, uses first IP in list)
 *
 * @param request - Native Request object
 * @returns Client IP address, or null if not found
 *
 * @example
 * ```typescript
 * // With native Request
 * const ip = getClientIp(request);
 * if (!ip) {
 *   throw new Error("Failed to extract client IP");
 * }
 *
 * // With Hono Context - use c.req.raw
 * const ip = getClientIp(c.req.raw);
 * ```
 */
export function getClientIp(request: Request): string | null {
  const cfConnectingIp = request.headers.get("CF-Connecting-IP");
  if (cfConnectingIp) return cfConnectingIp;

  const xRealIp = request.headers.get("X-Real-IP");
  if (xRealIp) return xRealIp;

  const xForwardedFor = request.headers.get("X-Forwarded-For");
  if (xForwardedFor) {
    const firstIp = xForwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  return null;
}
