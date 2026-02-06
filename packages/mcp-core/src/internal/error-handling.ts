import {
  UserInputError,
  ConfigurationError,
  LLMProviderError,
} from "../errors";
import { ApiError, ApiClientError, ApiServerError } from "../api-client";
import { logIssue } from "../telem/logging";
import { APICallError } from "ai";
import type { TransportType } from "../types";

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
 * Type guard to identify AI SDK API call errors.
 */
export function isAPICallError(error: unknown): error is APICallError {
  return APICallError.isInstance(error);
}

const GENERIC_CONFIG_ERROR_MESSAGE = [
  "**Feature Unavailable**",
  "This feature is temporarily unavailable due to a server configuration issue.",
  "The service operator has been notified. Please try again later.",
].join("\n\n");

/**
 * Check whether this is an HTTP transport where server-side config errors
 * should be hidden from the user. When true, the error is logged to Sentry
 * and a generic message is returned instead of the detailed error.
 */
function isHttpTransport(options?: { transport?: TransportType }): boolean {
  return options?.transport === "http";
}

/**
 * For HTTP transport, log a server-side config/provider error to Sentry and
 * return a generic message (the user cannot fix server-side configuration).
 * Returns undefined for stdio/unset transport so the caller can fall through
 * to the detailed error message.
 */
function redactForHttpTransport(
  error: Error,
  options?: { transport?: TransportType },
): string | undefined {
  if (!isHttpTransport(options)) {
    return undefined;
  }
  logIssue(error);
  return GENERIC_CONFIG_ERROR_MESSAGE;
}

/**
 * Format an error for user display with markdown formatting.
 * This is used by tool handlers to format errors for MCP responses.
 *
 * When transport is "http", config/provider errors are logged to Sentry
 * and a generic message is returned (users can't fix server-side config).
 * When transport is "stdio" or undefined, detailed messages are returned
 * (users can fix their own config).
 *
 * SECURITY: Only return trusted error messages to prevent prompt injection vulnerabilities.
 * We trust: Sentry API errors, our own UserInputError/ConfigurationError messages, and system templates.
 */
export async function formatErrorForUser(
  error: unknown,
  options?: { transport?: TransportType },
): Promise<string> {
  if (isUserInputError(error)) {
    return [
      "**Input Error**",
      "It looks like there was a problem with the input you provided.",
      error.message,
      "You may be able to resolve the issue by addressing the concern and trying again.",
    ].join("\n\n");
  }

  if (isConfigurationError(error)) {
    return (
      redactForHttpTransport(error, options) ??
      [
        "**Configuration Error**",
        "There appears to be a configuration issue with your setup.",
        error.message,
        "Please check your environment configuration and try again.",
      ].join("\n\n")
    );
  }

  if (isLLMProviderError(error)) {
    return (
      redactForHttpTransport(error, options) ??
      [
        "**AI Provider Error**",
        "The AI provider service is not available for this request.",
        error.message,
        "This is a service availability issue that cannot be resolved by retrying.",
      ].join("\n\n")
    );
  }

  // Handle AI SDK APICallError that wasn't converted to LLMProviderError.
  // This is a defensive layer - ideally callEmbeddedAgent converts these.
  if (isAPICallError(error)) {
    const statusCode = error.statusCode;
    // 4xx errors are user-facing (account issues, rate limits, invalid keys)
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return (
        redactForHttpTransport(error, options) ??
        [
          "**AI Provider Error**",
          "The AI provider service returned an error.",
          error.message,
          "This may be a configuration or account issue. Please check your AI provider settings.",
        ].join("\n\n")
      );
    }
    // 5xx errors - always log to Sentry regardless of transport
    const eventId = logIssue(error);
    const parts = [
      "**AI Provider Error**",
      "An unexpected error occurred with the AI provider.",
      error.message,
    ];
    if (eventId) {
      parts.push(`**Event ID**: ${eventId}`);
    }
    parts.push("Please contact support if the problem persists.");
    return parts.join("\n\n");
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
      "You may be able to resolve the issue by addressing the concern and trying again.",
    ].join("\n\n");
  }

  // Handle ApiServerError (5xx) - system errors, SHOULD be logged to Sentry
  if (isApiServerError(error)) {
    const eventId = logIssue(error);
    const statusText = error.status
      ? `There was an HTTP ${error.status} server error with the Sentry API.`
      : "There was a server error.";

    const parts = ["**Error**", statusText, error.message];
    if (eventId) {
      parts.push(`**Event ID**: ${eventId}`);
    }
    parts.push("Please contact support if the problem persists.");
    return parts.join("\n\n");
  }

  // Handle generic ApiError (shouldn't happen with new hierarchy, but just in case)
  if (isApiError(error)) {
    const statusText = error.status
      ? `There was an HTTP ${error.status} error with your request to the Sentry API.`
      : "There was an error with your request.";

    return [
      "**Error**",
      statusText,
      error.message,
      "You may be able to resolve the issue by addressing the concern and trying again.",
    ].join("\n\n");
  }

  const eventId = logIssue(error);

  const parts = [
    "**Error**",
    "It looks like there was a problem communicating with the Sentry API.",
    "Please report the following to the user for the Sentry team:",
  ];
  if (eventId) {
    parts.push(`**Event ID**: ${eventId}`);
  }
  if (process.env.NODE_ENV !== "production") {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg) {
      parts.push(errorMsg);
    }
  }
  return parts.join("\n\n");
}
