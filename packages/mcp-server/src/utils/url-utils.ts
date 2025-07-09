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
