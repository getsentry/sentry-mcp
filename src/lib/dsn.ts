/**
 * DSN Parser
 *
 * Parses Sentry DSN strings to extract organization and project identifiers.
 *
 * DSN Format: {PROTOCOL}://{PUBLIC_KEY}@{HOST}/{PROJECT_ID}
 * Example: https://abc123@o1169445.ingest.us.sentry.io/4505229541441536
 *
 * For SaaS DSNs, the host contains the org ID in the pattern: oXXX.ingest...
 */

import type { ParsedDsn } from "../types/index.js";

/**
 * Regular expression to match org ID from Sentry SaaS ingest hosts
 * Matches patterns like: o1169445.ingest.sentry.io or o1169445.ingest.us.sentry.io
 */
const ORG_ID_PATTERN = /^o(\d+)\.ingest(?:\.[a-z]+)?\.sentry\.io$/;

/**
 * Extract organization ID from a Sentry ingest host
 *
 * @param host - The host portion of the DSN (e.g., "o1169445.ingest.us.sentry.io")
 * @returns The numeric org ID as a string, or null if not a SaaS ingest host
 *
 * @example
 * extractOrgIdFromHost("o1169445.ingest.us.sentry.io") // "1169445"
 * extractOrgIdFromHost("o123.ingest.sentry.io") // "123"
 * extractOrgIdFromHost("sentry.mycompany.com") // null (self-hosted)
 */
export function extractOrgIdFromHost(host: string): string | null {
  const match = host.match(ORG_ID_PATTERN);
  return match?.[1] ?? null;
}

/**
 * Parse a Sentry DSN string into its components
 *
 * @param dsn - The full DSN string
 * @returns Parsed DSN components, or null if invalid
 *
 * @example
 * parseDsn("https://abc123@o1169445.ingest.us.sentry.io/4505229541441536")
 * // {
 * //   protocol: "https",
 * //   publicKey: "abc123",
 * //   host: "o1169445.ingest.us.sentry.io",
 * //   projectId: "4505229541441536",
 * //   orgId: "1169445"
 * // }
 */
export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);

    // Protocol without the trailing colon
    const protocol = url.protocol.replace(/:$/, "");

    // Public key is the username portion
    const publicKey = url.username;
    if (!publicKey) {
      return null;
    }

    // Host
    const host = url.host;
    if (!host) {
      return null;
    }

    // Project ID is the last path segment
    const pathParts = url.pathname.split("/").filter(Boolean);
    const projectId = pathParts[pathParts.length - 1];
    if (!projectId) {
      return null;
    }

    // Try to extract org ID from host (SaaS only)
    const orgId = extractOrgIdFromHost(host) ?? undefined;

    return {
      protocol,
      publicKey,
      host,
      projectId,
      orgId,
    };
  } catch {
    // Invalid URL
    return null;
  }
}

/**
 * Validate that a string looks like a Sentry DSN
 *
 * @param value - String to validate
 * @returns True if the string appears to be a valid DSN
 */
export function isValidDsn(value: string): boolean {
  return parseDsn(value) !== null;
}
