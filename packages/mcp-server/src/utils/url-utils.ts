/**
 * Normalizes a host/URL input to ensure it has a protocol.
 * Accepts both:
 * - Hostnames: "sentry.io", "localhost:8000"
 * - Full URLs: "https://sentry.io", "http://localhost:8000"
 *
 * @param hostOrUrl The host or URL to normalize
 * @param defaultProtocol The protocol to use if none is provided (defaults to "https")
 * @returns A normalized URL with protocol
 */
export function normalizeHost(
  hostOrUrl: string,
  defaultProtocol = "https",
): string {
  // If it already has a protocol, return as-is
  if (hostOrUrl.startsWith("http://") || hostOrUrl.startsWith("https://")) {
    return hostOrUrl;
  }

  // Otherwise, prepend the default protocol
  return `${defaultProtocol}://${hostOrUrl}`;
}

/**
 * Extracts just the hostname (without protocol) from a host/URL input.
 *
 * @param hostOrUrl The host or URL to extract from
 * @returns The hostname without protocol
 */
export function extractHostname(hostOrUrl: string): string {
  try {
    // Try to parse as URL
    const url = new URL(normalizeHost(hostOrUrl));
    return url.host;
  } catch {
    // If parsing fails, assume it's already just a hostname
    return hostOrUrl;
  }
}
