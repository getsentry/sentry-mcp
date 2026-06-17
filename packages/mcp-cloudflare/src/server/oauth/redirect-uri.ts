function isLoopbackRedirectUri(uri: string): boolean {
  try {
    const host = new URL(uri).hostname;
    return (
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
      host === "::1" ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}

/**
 * Checks whether a requested redirect URI is allowed for a client.
 *
 * Loopback redirects follow RFC 8252 semantics: clients may receive a dynamic
 * local port, so the registered and requested URI must match except for port.
 */
export function isRedirectUriAllowed(
  redirectUri: string,
  registeredUris: string[] | undefined,
): boolean {
  if (!registeredUris) {
    return false;
  }

  return registeredUris.some((registeredUri) => {
    if (
      isLoopbackRedirectUri(redirectUri) &&
      isLoopbackRedirectUri(registeredUri)
    ) {
      try {
        const requested = new URL(redirectUri);
        const registered = new URL(registeredUri);
        return (
          requested.protocol === registered.protocol &&
          requested.hostname === registered.hostname &&
          requested.pathname === registered.pathname &&
          requested.search === registered.search
        );
      } catch {
        return false;
      }
    }

    return redirectUri === registeredUri;
  });
}
