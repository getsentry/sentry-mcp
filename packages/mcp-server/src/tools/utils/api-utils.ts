import { SentryApiService, ApiError } from "../../api-client/index";
import { UserInputError } from "../../errors";
import type { ServerContext } from "../../types";

/**
 * Create a Sentry API service from server context with optional region override
 * @param context - Server context containing host and access token
 * @param opts - Options object containing optional regionUrl override
 * @returns Configured SentryApiService instance (always uses HTTPS)
 * @throws {UserInputError} When regionUrl is provided but invalid
 */
export function apiServiceFromContext(
  context: ServerContext,
  opts: { regionUrl?: string } = {},
) {
  let host = context.sentryHost;

  if (opts.regionUrl?.trim()) {
    try {
      const parsedUrl = new URL(opts.regionUrl);

      // Validate that the URL has a proper protocol
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new UserInputError(
          `Invalid regionUrl provided: ${opts.regionUrl}. Must include protocol (http:// or https://).`,
        );
      }

      // Validate that the host is not just the protocol name
      if (parsedUrl.host === "https" || parsedUrl.host === "http") {
        throw new UserInputError(
          `Invalid regionUrl provided: ${opts.regionUrl}. The host cannot be just a protocol name.`,
        );
      }

      host = parsedUrl.host;
    } catch (error) {
      if (error instanceof UserInputError) {
        throw error;
      }
      throw new UserInputError(
        `Invalid regionUrl provided: ${opts.regionUrl}. Must be a valid URL.`,
      );
    }
  }

  return new SentryApiService({
    host,
    accessToken: context.accessToken,
  });
}

/**
 * Maps API errors to user-friendly errors based on context
 * @param error - The error to handle
 * @param params - The parameters that were used in the API call
 * @returns Never - always throws an error
 * @throws {ApiError} For 4xx errors - preserves original error for agents to handle
 * @throws {Error} For other errors
 */
export function handleApiError(
  error: unknown,
  params?: Record<string, unknown>,
): never {
  // For API errors, preserve the original error type and information
  // This allows agents to see the exact status code and adjust their approach
  if (error instanceof ApiError) {
    // For 404s, we can add helpful context about parameters
    if (error.status === 404 && params) {
      const paramsList: string[] = [];
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          paramsList.push(`${key}: '${value}'`);
        }
      }

      if (paramsList.length > 0) {
        // Create a new ApiError with enhanced message but preserve status code
        throw new ApiError(
          `${error.message}. Please verify these parameters are correct:\n${paramsList.map((p) => `  - ${p}`).join("\n")}`,
          error.status,
        );
      }
    }

    // For all 4xx errors (including 404 without params), preserve the original error
    // Agents can check error.status to determine how to handle it
    if (error.status >= 400 && error.status < 500) {
      throw error;
    }
  }

  // Re-throw any other errors as-is (including 5xx server errors)
  throw error;
}

/**
 * Wraps an async API call with automatic error handling
 * @param fn - The async function to execute
 * @param params - The parameters that were used in the API call
 * @returns The result of the function
 * @throws {UserInputError} For user input errors
 * @throws {Error} For other errors
 */
export async function withApiErrorHandling<T>(
  fn: () => Promise<T>,
  params?: Record<string, unknown>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    handleApiError(error, params);
  }
}
