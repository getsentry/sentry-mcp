/**
 * PKCE (RFC 7636) test fixtures for OAuth authorization code flow tests.
 *
 * workers-oauth-provider >= 0.9.0 requires public clients
 * (`tokenEndpointAuthMethod: "none"`) to use PKCE with S256. Tests that
 * simulate that flow need a matching code_verifier / code_challenge pair.
 */

/** Fixed S256 pair for tests that build state objects directly. */
export const PKCE_CODE_VERIFIER =
  "test-pkce-code-verifier-1234567890abcdefghijk";
export const PKCE_CODE_CHALLENGE =
  "X46Lw4j5p8VeivcW_ziKr53fpJ5aYrg_thrV20R8jZQ";

function base64UrlEncode(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Generates a fresh S256 pair for tests that exercise the real authorize endpoint. */
export async function createPkcePair(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const codeVerifier = base64UrlEncode(
    crypto.getRandomValues(new Uint8Array(32)).buffer,
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );

  return { codeVerifier, codeChallenge: base64UrlEncode(digest) };
}
