/**
 * Redirect URI matching shared by the authorize and callback OAuth routes.
 *
 * Mirrors the semantics of `isValidRedirectUri` in `@cloudflare/workers-oauth-provider`,
 * which validates the same URI during `parseAuthRequest` and `completeAuthorization`.
 * Keeping the two in agreement stops a request the provider accepts from being
 * rejected by our own route handlers.
 */

/**
 * Checks whether a URI targets the loopback interface (127.0.0.0/8, ::1, or localhost).
 */
export function isLoopbackUri(uri: string): boolean {
  try {
    const { hostname } = new URL(uri);
    return (
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.toLowerCase() === "localhost"
    );
  } catch {
    return false;
  }
}

/**
 * Checks a requested redirect URI against a client's registered URIs.
 *
 * Loopback URIs ignore the port, per RFC 8252 Section 7.3: native apps take an
 * ephemeral port from the OS at request time, so a CIMD metadata document cannot
 * declare it ahead of publication. Scheme, host, path, and query must still match.
 * Every other URI requires exact equality.
 */
export function isRegisteredRedirectUri(
  requestUri: string,
  registeredUris: string[] | undefined,
): boolean {
  if (!Array.isArray(registeredUris)) {
    return false;
  }

  return registeredUris.some((registered) => {
    if (!isLoopbackUri(requestUri) || !isLoopbackUri(registered)) {
      return requestUri === registered;
    }

    try {
      const request = new URL(requestUri);
      const allowed = new URL(registered);
      return (
        request.protocol === allowed.protocol &&
        request.hostname === allowed.hostname &&
        request.pathname === allowed.pathname &&
        request.search === allowed.search
      );
    } catch {
      return false;
    }
  });
}
