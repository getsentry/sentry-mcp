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
 * @throws {UserInputError} For errors that are clearly user input issues
 * @throws {Error} For other errors
 */
export function handleApiError(
  error: unknown,
  params?: Record<string, unknown>,
): never {
  if (error instanceof ApiError && error.status === 404) {
    // Build a list of all provided parameters
    const paramsList: string[] = [];
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          paramsList.push(`${key}: '${value}'`);
        }
      }
    }

    if (paramsList.length > 0) {
      throw new UserInputError(
        `Resource not found. Please verify these parameters are correct:\n${paramsList.map((p) => `  - ${p}`).join("\n")}`,
      );
    }

    // Fallback to generic message if no params provided
    throw new UserInputError(
      `Resource not found (404). Please verify that all provided identifiers are correct and you have access to the requested resources.`,
    );
  }

  // For other API errors, check if they're likely user input issues
  if (error instanceof ApiError) {
    // 400 Bad Request often indicates invalid parameters
    if (error.status === 400) {
      throw new UserInputError(`Invalid request: ${error.message}`);
    }

    // 403 Forbidden might be a permissions issue but could also be wrong org/project
    if (error.status === 403) {
      throw new UserInputError(
        `Access denied: ${error.message}. Please verify you have access to this resource.`,
      );
    }
  }

  // Re-throw any other errors as-is
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
