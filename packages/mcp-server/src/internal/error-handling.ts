import { UserInputError, ConfigurationError } from "../errors";
import { ApiError } from "../api-client";
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
 * Format an error for user display with markdown formatting.
 * This is used by tool handlers to format errors for MCP responses.
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

  if (isApiError(error)) {
    // Log 500+ errors to Sentry for debugging
    const eventId = error.status >= 500 ? logError(error) : undefined;

    return [
      "**Error**",
      `There was an HTTP ${error.status} error with your request to the Sentry API.`,
      `${error.message}`,
      eventId ? `**Event ID**: ${eventId}` : "",
      `You may be able to resolve the issue by addressing the concern and trying again.`,
    ]
      .filter(Boolean)
      .join("\n\n");
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
