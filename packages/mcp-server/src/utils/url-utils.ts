/**
 * Determines if a Sentry instance is SaaS or self-hosted based on the host.
 * @param host The Sentry host (e.g., "sentry.io" or "sentry.company.com")
 * @returns true if SaaS instance, false if self-hosted
 */
export function isSentryHost(host: string): boolean {
  return host === "sentry.io" || host.endsWith(".sentry.io");
}

/**
 * Generates a Sentry issue URL.
 * @param host The Sentry host (may include regional subdomain for API access)
 * @param organizationSlug Organization identifier
 * @param issueId Issue identifier (e.g., "PROJECT-123")
 * @returns The complete issue URL
 */
export function getIssueUrl(
  host: string,
  organizationSlug: string,
  issueId: string,
): string {
  const isSaas = isSentryHost(host);
  // For SaaS instances, always use sentry.io for web UI URLs regardless of region
  // Regional subdomains (e.g., us.sentry.io) are only for API endpoints
  const webHost = isSaas ? "sentry.io" : host;
  return isSaas
    ? `https://${organizationSlug}.${webHost}/issues/${issueId}`
    : `https://${host}/organizations/${organizationSlug}/issues/${issueId}`;
}

/**
 * Generates a Sentry issues search URL.
 * @param host The Sentry host (may include regional subdomain for API access)
 * @param organizationSlug Organization identifier
 * @param query Optional search query
 * @param projectSlugOrId Optional project slug or ID
 * @returns The complete issues search URL
 */
export function getIssuesSearchUrl(
  host: string,
  organizationSlug: string,
  query?: string | null,
  projectSlugOrId?: string,
): string {
  const isSaas = isSentryHost(host);
  // For SaaS instances, always use sentry.io for web UI URLs regardless of region
  // Regional subdomains (e.g., us.sentry.io) are only for API endpoints
  const webHost = isSaas ? "sentry.io" : host;
  let url = isSaas
    ? `https://${organizationSlug}.${webHost}/issues/`
    : `https://${host}/organizations/${organizationSlug}/issues/`;

  const params = new URLSearchParams();
  if (projectSlugOrId) {
    params.append("project", projectSlugOrId);
  }
  if (query) {
    params.append("query", query);
  }

  const queryString = params.toString();
  if (queryString) {
    url += `?${queryString}`;
  }

  return url;
}

/**
 * Generates a Sentry trace URL for performance investigation.
 * @param host The Sentry host (may include regional subdomain for API access)
 * @param organizationSlug Organization identifier
 * @param traceId Trace identifier
 * @returns The complete trace URL
 */
export function getTraceUrl(
  host: string,
  organizationSlug: string,
  traceId: string,
): string {
  const isSaas = isSentryHost(host);
  // For SaaS instances, always use sentry.io for web UI URLs regardless of region
  // Regional subdomains (e.g., us.sentry.io) are only for API endpoints
  const webHost = isSaas ? "sentry.io" : host;
  return isSaas
    ? `https://${organizationSlug}.${webHost}/explore/traces/trace/${traceId}`
    : `https://${host}/organizations/${organizationSlug}/explore/traces/trace/${traceId}`;
}

/**
 * Generates a Sentry events explorer URL.
 * @param host The Sentry host (may include regional subdomain for API access)
 * @param organizationSlug Organization identifier
 * @param query Search query
 * @param dataset Dataset type
 * @param projectSlug Optional project slug
 * @param fields Optional fields to display
 * @returns The complete events explorer URL
 */
export function getEventsExplorerUrl(
  host: string,
  organizationSlug: string,
  query: string,
  dataset: "spans" | "errors" | "logs" = "spans",
  projectSlug?: string,
  fields?: string[],
): string {
  const isSaas = isSentryHost(host);
  // For SaaS instances, always use sentry.io for web UI URLs regardless of region
  // Regional subdomains (e.g., us.sentry.io) are only for API endpoints
  const webHost = isSaas ? "sentry.io" : host;
  let url = isSaas
    ? `https://${organizationSlug}.${webHost}/explore/`
    : `https://${host}/organizations/${organizationSlug}/explore/`;

  const params = new URLSearchParams();
  params.append("query", query);
  params.append("dataset", dataset);
  params.append("layout", "table");

  if (projectSlug) {
    params.append("project", projectSlug);
  }

  if (fields && fields.length > 0) {
    for (const field of fields) {
      params.append("field", field);
    }
  }

  url += `?${params.toString()}`;
  return url;
}

/**
 * Internal validation function that checks if a SENTRY_HOST value contains only hostname (no protocol).
 * Throws an error if validation fails instead of exiting the process.
 *
 * @param host The hostname to validate
 * @throws {Error} If the host contains a protocol
 */
function _validateSentryHostInternal(host: string): void {
  if (host.startsWith("http://") || host.startsWith("https://")) {
    throw new Error(
      "SENTRY_HOST should only contain a hostname (e.g., sentry.example.com). Use SENTRY_URL if you want to provide a full URL.",
    );
  }
}

/**
 * Internal validation function that checks if a SENTRY_URL value is a valid HTTPS URL and extracts the hostname.
 * Throws an error if validation fails instead of exiting the process.
 *
 * @param url The HTTPS URL to validate and parse
 * @returns The extracted hostname from the URL
 * @throws {Error} If the URL is invalid or not HTTPS
 */
function _validateAndParseSentryUrlInternal(url: string): string {
  if (!url.startsWith("https://")) {
    throw new Error(
      "SENTRY_URL must be a full HTTPS URL (e.g., https://sentry.example.com).",
    );
  }

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.host;
  } catch (error) {
    throw new Error(
      "SENTRY_URL must be a valid HTTPS URL (e.g., https://sentry.example.com).",
    );
  }
}

/**
 * Validates that a SENTRY_HOST value contains only hostname (no protocol).
 * Exits the process with error code 1 if validation fails (CLI behavior).
 *
 * @param host The hostname to validate
 */
export function validateSentryHost(host: string): void {
  try {
    _validateSentryHostInternal(host);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Validates that a SENTRY_URL value is a valid HTTPS URL and extracts the hostname.
 * Exits the process with error code 1 if validation fails (CLI behavior).
 *
 * @param url The HTTPS URL to validate and parse
 * @returns The extracted hostname from the URL
 */
export function validateAndParseSentryUrl(url: string): string {
  try {
    return _validateAndParseSentryUrlInternal(url);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Validates that a SENTRY_HOST value contains only hostname (no protocol).
 * Throws an error instead of exiting the process (for testing).
 *
 * @param host The hostname to validate
 * @throws {Error} If the host contains a protocol
 */
export function validateSentryHostThrows(host: string): void {
  _validateSentryHostInternal(host);
}

/**
 * Validates that a SENTRY_URL value is a valid HTTPS URL and extracts the hostname.
 * Throws an error instead of exiting the process (for testing).
 *
 * @param url The HTTPS URL to validate and parse
 * @returns The extracted hostname from the URL
 * @throws {Error} If the URL is invalid or not HTTPS
 */
export function validateAndParseSentryUrlThrows(url: string): string {
  return _validateAndParseSentryUrlInternal(url);
}

/**
 * Validates that the provided OpenAI base URL is a valid HTTP(S) URL and returns a normalized string.
 *
 * @param url The URL to validate and normalize
 * @returns The normalized URL string
 * @throws {Error} If the URL is empty, invalid, or uses an unsupported protocol
 */
export function validateOpenAiBaseUrlThrows(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw new Error("OPENAI base URL must not be empty.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    throw new Error(
      "OPENAI base URL must be a valid HTTP or HTTPS URL (e.g., https://example.com/v1).",
      { cause: error },
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      "OPENAI base URL must use http or https scheme (e.g., https://example.com/v1).",
    );
  }

  // Preserve the exact path to support Azure or proxy endpoints that include version/path segments
  return parsed.toString();
}
