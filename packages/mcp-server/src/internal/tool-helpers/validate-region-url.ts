import { UserInputError } from "../../errors";

/**
 * Allowed region subdomains for sentry.io
 * Only these specific regions are permitted when using Sentry's cloud service
 */
const SENTRY_IO_ALLOWED_REGIONS = new Set(["us", "de"]);

/**
 * Validates that a regionUrl is a valid subset of the base host.
 * Prevents SSRF attacks by ensuring the regionUrl cannot point to arbitrary external domains.
 *
 * Rules:
 * 1. regionUrl host must be the base host or a subdomain of it
 * 2. For sentry.io, only specific region subdomains are allowed (us, de)
 * 3. Protocol must be http:// or https://
 *
 * @param regionUrl - The region URL to validate
 * @param baseHost - The base host to validate against
 * @returns The validated host if valid
 * @throws {UserInputError} If the regionUrl is invalid
 */
export function validateRegionUrl(regionUrl: string, baseHost: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(regionUrl);
  } catch {
    throw new UserInputError(
      `Invalid regionUrl provided: ${regionUrl}. Must be a valid URL.`,
    );
  }

  // Validate protocol
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new UserInputError(
      `Invalid regionUrl provided: ${regionUrl}. Must include protocol (http:// or https://).`,
    );
  }

  // Validate that the host is not just the protocol name
  if (parsedUrl.host === "https" || parsedUrl.host === "http") {
    throw new UserInputError(
      `Invalid regionUrl provided: ${regionUrl}. The host cannot be just a protocol name.`,
    );
  }

  const regionHost = parsedUrl.host.toLowerCase();
  const baseLower = baseHost.toLowerCase();

  // For sentry.io, enforce allowlist
  if (baseLower === "sentry.io") {
    // Allow exact match
    if (regionHost === "sentry.io") {
      return regionHost;
    }

    // Check if it's a subdomain
    const match = regionHost.match(/^([^.]+)\.sentry\.io$/);
    if (!match) {
      throw new UserInputError(
        `Invalid regionUrl: ${regionUrl}. For sentry.io, regionUrl must be sentry.io or [region].sentry.io`,
      );
    }

    // Validate against allowlist
    const region = match[1];
    if (!SENTRY_IO_ALLOWED_REGIONS.has(region)) {
      throw new UserInputError(
        `Invalid regionUrl: ${regionUrl}. Allowed regions for sentry.io are: ${Array.from(SENTRY_IO_ALLOWED_REGIONS).join(", ")}`,
      );
    }

    return regionHost;
  }

  // For other hosts (self-hosted), must be same domain or subdomain
  if (regionHost === baseLower) {
    return regionHost;
  }

  // Check if it's a subdomain of the base host
  if (regionHost.endsWith(`.${baseLower}`)) {
    return regionHost;
  }

  throw new UserInputError(
    `Invalid regionUrl: ${regionUrl}. The regionUrl host must be ${baseHost} or a subdomain of ${baseHost}`,
  );
}
