/**
 * API Error Class Hierarchy
 *
 * This module defines a hierarchical error system for the Sentry API client
 * that automatically categorizes errors based on HTTP status codes.
 *
 * Key principles:
 * - 4xx errors (ApiClientError) are user input errors, not reported to Sentry
 * - 5xx errors (ApiServerError) are system errors, reported to Sentry
 * - Specific error types provide additional context and helper methods
 * - The hierarchy enables type-safe error handling without manual status checks
 */

/**
 * Base class for all API errors.
 * Contains common properties for all API error types.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/**
 * Client errors (4xx) - User input errors that should NOT be reported to Sentry.
 * These typically indicate issues with the request that the user can fix.
 */
export class ApiClientError extends ApiError {
  constructor(
    message: string,
    status: number,
    detail?: string,
    responseBody?: unknown,
  ) {
    super(message, status, detail, responseBody);
    this.name = "ApiClientError";
    Object.setPrototypeOf(this, ApiClientError.prototype);
  }

  /**
   * Convert to a user-friendly formatted message.
   * Returns the standard format: "API error (status): message"
   * For 404 errors, adds helpful context about checking parameters.
   */
  toUserMessage(): string {
    const baseMessage = `API error (${this.status}): ${this.message}`;

    // Add helpful context for 404 errors, especially generic ones
    if (this.status === 404) {
      // Check if the message is generic
      const genericMessages = [
        "not found",
        "the requested resource does not exist",
        "resource does not exist",
        "resource not found",
      ];

      const isGeneric = genericMessages.some(
        (msg) =>
          this.message.toLowerCase() === msg ||
          this.message.toLowerCase().includes("requested resource"),
      );

      if (isGeneric) {
        return `${baseMessage}. Please verify that the organization, project, or resource ID is correct and that you have access to it.`;
      }
      // For specific messages like "Project not found", just add a hint
      return `${baseMessage}. Please verify the parameters are correct.`;
    }

    return baseMessage;
  }

  /**
   * Check if this is a permission/authorization error (403)
   */
  isPermissionError(): boolean {
    return this.status === 403;
  }

  /**
   * Check if this is a not found error (404)
   */
  isNotFoundError(): boolean {
    return this.status === 404;
  }

  /**
   * Check if this is a validation error (400 or 422)
   */
  isValidationError(): boolean {
    return this.status === 400 || this.status === 422;
  }

  /**
   * Check if this is an authentication error (401)
   */
  isAuthenticationError(): boolean {
    return this.status === 401;
  }

  /**
   * Check if this is a rate limit error (429)
   */
  isRateLimitError(): boolean {
    return this.status === 429;
  }
}

/**
 * Permission denied error (403).
 * Includes special handling for multi-project access errors.
 */
export class ApiPermissionError extends ApiClientError {
  constructor(message: string, detail?: string, responseBody?: unknown) {
    super(message, 403, detail, responseBody);
    this.name = "ApiPermissionError";
    Object.setPrototypeOf(this, ApiPermissionError.prototype);
  }

  /**
   * Check if this is the specific multi-project access error
   */
  isMultiProjectAccessError(): boolean {
    return (
      this.message.includes("multiple projects") ||
      this.message.includes("multi project") ||
      this.message.includes("multi-project") ||
      this.message.includes(
        "You do not have access to query across multiple projects",
      )
    );
  }
}

/**
 * Resource not found error (404).
 * Can include additional context about what resource was not found.
 */
export class ApiNotFoundError extends ApiClientError {
  constructor(
    message: string,
    detail?: string,
    responseBody?: unknown,
    public readonly resourceType?: string,
    public readonly resourceId?: string,
  ) {
    super(message, 404, detail, responseBody);
    this.name = "ApiNotFoundError";
    Object.setPrototypeOf(this, ApiNotFoundError.prototype);
  }
}

/**
 * Validation error (400 or 422).
 * Indicates the request was malformed or contained invalid data.
 */
export class ApiValidationError extends ApiClientError {
  constructor(
    message: string,
    status: 400 | 422,
    detail?: string,
    responseBody?: unknown,
    public readonly validationErrors?: Record<string, string[]>,
  ) {
    super(message, status, detail, responseBody);
    this.name = "ApiValidationError";
    Object.setPrototypeOf(this, ApiValidationError.prototype);
  }
}

/**
 * Authentication error (401).
 * Indicates the request lacks valid authentication credentials.
 */
export class ApiAuthenticationError extends ApiClientError {
  constructor(message: string, detail?: string, responseBody?: unknown) {
    super(message, 401, detail, responseBody);
    this.name = "ApiAuthenticationError";
    Object.setPrototypeOf(this, ApiAuthenticationError.prototype);
  }
}

/**
 * Rate limit error (429).
 * Includes retry-after information when available.
 */
export class ApiRateLimitError extends ApiClientError {
  constructor(
    message: string,
    detail?: string,
    responseBody?: unknown,
    public readonly retryAfter?: number,
  ) {
    super(message, 429, detail, responseBody);
    this.name = "ApiRateLimitError";
    Object.setPrototypeOf(this, ApiRateLimitError.prototype);
  }
}

/**
 * Server errors (5xx) - System errors that SHOULD be reported to Sentry.
 * These indicate problems with the server that are not the user's fault.
 */
export class ApiServerError extends ApiError {
  constructor(
    message: string,
    status: number,
    detail?: string,
    responseBody?: unknown,
  ) {
    super(message, status, detail, responseBody);
    this.name = "ApiServerError";
    Object.setPrototypeOf(this, ApiServerError.prototype);
  }

  /**
   * Check if this is a gateway/proxy error (502, 503, 504)
   */
  isGatewayError(): boolean {
    return this.status === 502 || this.status === 503 || this.status === 504;
  }

  /**
   * Check if this is an internal server error (500)
   */
  isInternalError(): boolean {
    return this.status === 500;
  }
}

/**
 * Factory function to create the appropriate error type based on HTTP status code.
 * This centralizes the logic for determining which error class to instantiate.
 */
export function createApiError(
  message: string,
  status: number,
  detail?: string,
  responseBody?: unknown,
): ApiError {
  // Apply message improvements for known error patterns
  let improvedMessage = message;

  // Handle the multi-project access error that comes in various forms
  if (
    message.includes(
      "You do not have the multi project stream feature enabled",
    ) ||
    message.includes("You cannot view events from multiple projects")
  ) {
    improvedMessage =
      "You do not have access to query across multiple projects. Please select a project for your query.";
    return new ApiPermissionError(improvedMessage, detail, responseBody);
  }

  // Create specific error types based on status code
  switch (status) {
    case 401:
      return new ApiAuthenticationError(message, detail, responseBody);

    case 403:
      return new ApiPermissionError(message, detail, responseBody);

    case 404:
      // TODO: Could extract resource type/ID from the request context
      return new ApiNotFoundError(message, detail, responseBody);

    case 400:
    case 422: {
      // Try to extract validation errors if present
      let validationErrors: Record<string, string[]> | undefined;
      if (
        responseBody &&
        typeof responseBody === "object" &&
        "errors" in responseBody
      ) {
        validationErrors = responseBody.errors as Record<string, string[]>;
      }
      return new ApiValidationError(
        message,
        status as 400 | 422,
        detail,
        responseBody,
        validationErrors,
      );
    }

    case 429: {
      // Try to extract retry-after header if available
      let retryAfter: number | undefined;
      if (responseBody && typeof responseBody === "object") {
        if ("retry_after" in responseBody) {
          retryAfter = Number(responseBody.retry_after);
        } else if ("retryAfter" in responseBody) {
          retryAfter = Number(responseBody.retryAfter);
        }
      }
      return new ApiRateLimitError(message, detail, responseBody, retryAfter);
    }

    default:
      // Generic categorization for other status codes
      if (status >= 400 && status < 500) {
        return new ApiClientError(message, status, detail, responseBody);
      }
      if (status >= 500 && status < 600) {
        return new ApiServerError(message, status, detail, responseBody);
      }
      // Fallback for unusual status codes
      return new ApiError(message, status, detail, responseBody);
  }
}
