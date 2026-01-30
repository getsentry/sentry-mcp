import {
  UserInputError,
  ConfigurationError,
  LLMProviderError,
} from "../errors";
import { ApiError, ApiClientError, ApiServerError } from "../api-client";
import { logIssue } from "../telem/logging";

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
 * Type guard to identify LLM provider errors.
 */
export function isLLMProviderError(error: unknown): error is LLMProviderError {
  return error instanceof LLMProviderError;
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

  if (isLLMProviderError(error)) {
    return [
      "**AI Provider Error**",
      "The AI provider service is not available for this request.",
      error.message,
      `This is a service availability issue that cannot be resolved by retrying.`,
    ].join("\n\n");
  }

  // Handle ApiClientError (4xx) - user input errors, should NOT be logged to Sentry
  if (isApiClientError(error)) {
    const statusText = error.status
      ? `There was an HTTP ${error.status} error with your request to the Sentry API.`
      : "There was an error with your request.";

    return [
      "**Input Error**",
      statusText,
      error.toUserMessage(),
      `You may be able to resolve the issue by addressing the concern and trying again.`,
    ].join("\n\n");
  }

  // Handle ApiServerError (5xx) - system errors, SHOULD be logged to Sentry
  if (isApiServerError(error)) {
    const eventId = logIssue(error);
    const statusText = error.status
      ? `There was an HTTP ${error.status} server error with the Sentry API.`
      : "There was a server error.";

    return [
      "**Error**",
      statusText,
      `${error.message}`,
      `**Event ID**: ${eventId}`,
      `Please contact support with this Event ID if the problem persists.`,
    ].join("\n\n");
  }

  // Handle generic ApiError (shouldn't happen with new hierarchy, but just in case)
  if (isApiError(error)) {
    const statusText = error.status
      ? `There was an HTTP ${error.status} error with your request to the Sentry API.`
      : "There was an error with your request.";

    return [
      "**Error**",
      statusText,
      `${error.message}`,
      `You may be able to resolve the issue by addressing the concern and trying again.`,
    ].join("\n\n");
  }

  const eventId = logIssue(error);

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
