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
 * @param context - Context about what was being attempted
 * @returns Never - always throws an error
 * @throws {UserInputError} For errors that are clearly user input issues
 * @throws {Error} For other errors
 */
export function handleApiError(
  error: unknown,
  context: {
    operation:
      | "getIssue"
      | "updateIssue"
      | "getEvent"
      | "getOrganization"
      | "getProject"
      | "getTeam";
    resourceId?: string;
    resourceType?: string;
  },
): never {
  if (error instanceof ApiError && error.status === 404) {
    const resourceType =
      context.resourceType ||
      context.operation.replace(/^get|update/, "").toLowerCase();
    const resourceId = context.resourceId || "unknown";

    switch (context.operation) {
      case "getIssue":
      case "updateIssue":
        throw new UserInputError(
          `Issue '${resourceId}' not found. Please verify the issue ID is correct.`,
        );
      case "getEvent":
        throw new UserInputError(
          `Event '${resourceId}' not found. Please verify the event ID is correct.`,
        );
      case "getOrganization":
        throw new UserInputError(
          `Organization '${resourceId}' not found. Please verify the organization slug is correct.`,
        );
      case "getProject":
        throw new UserInputError(
          `Project '${resourceId}' not found. Please verify the project slug is correct.`,
        );
      case "getTeam":
        throw new UserInputError(
          `Team '${resourceId}' not found. Please verify the team slug is correct.`,
        );
      default:
        throw new UserInputError(
          `${resourceType} '${resourceId}' not found. Please verify the ID is correct.`,
        );
    }
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
 * @param context - Context about what operation is being performed
 * @returns The result of the function
 * @throws {UserInputError} For user input errors
 * @throws {Error} For other errors
 */
export async function withApiErrorHandling<T>(
  fn: () => Promise<T>,
  context: Parameters<typeof handleApiError>[1],
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    handleApiError(error, context);
  }
}
