import { UserInputError, ConfigurationError } from "../errors";
import { ApiError, ApiClientError, ApiServerError } from "../api-client";
import { logError } from "../logging";

/**
 * Type guard to identify user input validation errors.
 */
export function isUserInputError(error: unknown): error is UserInputError {
  return error instanceof UserInputError;
}

/**
 * Type guard to identify configuration errors.
 */
export function isConfigurationError(
  error: unknown,
): error is ConfigurationError {
  return error instanceof ConfigurationError;
}

/**
 * Type guard to identify API errors.
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Type guard to identify API client errors (4xx).
 */
export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

/**
 * Type guard to identify API server errors (5xx).
 */
export function isApiServerError(error: unknown): error is ApiServerError {
  return error instanceof ApiServerError;
}

/**
 * Format an error for user display with markdown formatting.
 * This is used by tool handlers to format errors for MCP responses.
 *
 * SECURITY: Only return trusted error messages to prevent prompt injection vulnerabilities.
 * We trust: Sentry API errors, our own UserInputError/ConfigurationError messages, and system templates.
 */
export async function formatErrorForUser(error: unknown): Promise<string> {
  if (isUserInputError(error)) {
    return [
      "**Input Error**",
      "It looks like there was a problem with the input you provided.",
      error.message,
      `You may be able to resolve the issue by addressing the concern and trying again.`,
    ].join("\n\n");
  }

  if (isConfigurationError(error)) {
    return [
      "**Configuration Error**",
      "There appears to be a configuration issue with your setup.",
      error.message,
      `Please check your environment configuration and try again.`,
    ].join("\n\n");
  }

  // Handle ApiClientError (4xx) - user input errors, should NOT be logged to Sentry
  if (isApiClientError(error)) {
    return [
      "**Input Error**",
      `There was an HTTP ${error.status} error with your request to the Sentry API.`,
      error.toUserMessage(),
      `You may be able to resolve the issue by addressing the concern and trying again.`,
    ].join("\n\n");
  }

  // Handle ApiServerError (5xx) - system errors, SHOULD be logged to Sentry
  if (isApiServerError(error)) {
    const eventId = logError(error);

    return [
      "**Error**",
      `There was an HTTP ${error.status} server error with the Sentry API.`,
      `${error.message}`,
      `**Event ID**: ${eventId}`,
      `Please contact support with this Event ID if the problem persists.`,
    ].join("\n\n");
  }

  // Handle generic ApiError (shouldn't happen with new hierarchy, but just in case)
  if (isApiError(error)) {
    return [
      "**Error**",
      `There was an HTTP ${error.status} error with your request to the Sentry API.`,
      `${error.message}`,
      `You may be able to resolve the issue by addressing the concern and trying again.`,
    ].join("\n\n");
  }

  const eventId = logError(error);

  return [
    "**Error**",
    "It looks like there was a problem communicating with the Sentry API.",
    "Please report the following to the user for the Sentry team:",
    `**Event ID**: ${eventId}`,
    process.env.NODE_ENV !== "production"
      ? error instanceof Error
        ? error.message
        : String(error)
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
