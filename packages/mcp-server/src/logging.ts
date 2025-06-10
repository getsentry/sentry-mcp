/**
 * Logging and telemetry utilities for error reporting.
 *
 * Provides centralized error logging with Sentry integration. Handles both
 * console logging for development and structured error reporting for production
 * monitoring and debugging.
 */
import { captureException, captureMessage, withScope } from "@sentry/core";

/**
 * Logs errors to console and Sentry with optional context and attachments.
 *
 * Supports both Error objects and string messages. Returns a Sentry event ID
 * that can be included in user-facing error messages for debugging support.
 *
 * @param error - Error object or message string to log
 * @param contexts - Additional context data for Sentry
 * @param attachments - Files or data to attach to the Sentry event
 * @returns Sentry event ID for referencing this error, or undefined if logging fails
 *
 * @example Error Object Logging
 * ```typescript
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   const eventId = logError(error, {
 *     operation: { name: "riskyOperation", params: {...} }
 *   });
 *   return `Error occurred. Event ID: ${eventId}`;
 * }
 * ```
 *
 * @example String Message Logging
 * ```typescript
 * const eventId = logError("Configuration validation failed", {
 *   config: { provided: userConfig, expected: expectedFormat }
 * });
 * ```
 */
export function logError(
  error: Error | unknown,
  contexts?: Record<string, Record<string, any>>,
  attachments?: Record<string, string | Uint8Array>,
): string | undefined;
export function logError(
  message: string,
  contexts?: Record<string, Record<string, any>>,
  attachments?: Record<string, string | Uint8Array>,
): string | undefined;
export function logError(
  error: string | Error | unknown,
  contexts?: Record<string, Record<string, any>>,
  attachments?: Record<string, string | Uint8Array>,
): string | undefined {
  const level = "error";

  console.error(error);

  const eventId = withScope((scope) => {
    if (attachments) {
      for (const [key, data] of Object.entries(attachments)) {
        scope.addAttachment({
          data,
          filename: key,
        });
      }
    }

    return typeof error === "string"
      ? captureMessage(error, {
          contexts,
          level,
        })
      : captureException(error, {
          contexts,
          level,
        });
  });

  return eventId;
}
