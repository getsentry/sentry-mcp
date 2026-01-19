/**
 * CLI Error Hierarchy
 *
 * Unified error classes for consistent error handling across the CLI.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Base Error
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base class for all CLI errors.
 *
 * @param message - Error message for display
 * @param exitCode - Process exit code (default: 1)
 */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }

  /**
   * Format error for user display. Override in subclasses to add details.
   */
  format(): string {
    return this.message;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * API request errors from Sentry.
 *
 * @param message - Error summary
 * @param status - HTTP status code
 * @param detail - Detailed error message from API response
 * @param endpoint - API endpoint that failed
 */
export class ApiError extends CliError {
  readonly status: number;
  readonly detail?: string;
  readonly endpoint?: string;

  constructor(
    message: string,
    status: number,
    detail?: string,
    endpoint?: string
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.endpoint = endpoint;
  }

  override format(): string {
    let msg = this.message;
    if (this.detail && this.detail !== this.message) {
      msg += `\n  ${this.detail}`;
    }
    return msg;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication Errors
// ─────────────────────────────────────────────────────────────────────────────

export type AuthErrorReason = "not_authenticated" | "expired" | "invalid";

/**
 * Authentication errors.
 *
 * @param reason - Type of auth failure
 * @param message - Custom message (uses default if not provided)
 */
export class AuthError extends CliError {
  readonly reason: AuthErrorReason;

  constructor(reason: AuthErrorReason, message?: string) {
    const defaultMessages: Record<AuthErrorReason, string> = {
      not_authenticated: "Not authenticated. Run 'sentry auth login' first.",
      expired:
        "Authentication expired. Run 'sentry auth login' to re-authenticate.",
      invalid: "Invalid authentication token.",
    };
    super(message ?? defaultMessages[reason]);
    this.name = "AuthError";
    this.reason = reason;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration or DSN errors.
 *
 * @param message - Error description
 * @param suggestion - Helpful hint for resolving the error
 */
export class ConfigError extends CliError {
  readonly suggestion?: string;

  constructor(message: string, suggestion?: string) {
    super(message);
    this.name = "ConfigError";
    this.suggestion = suggestion;
  }

  override format(): string {
    let msg = this.message;
    if (this.suggestion) {
      msg += `\n\nSuggestion: ${this.suggestion}`;
    }
    return msg;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Errors (Missing Required Context)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONTEXT_ALTERNATIVES = [
  "Run from a directory with a Sentry-configured project",
  "Set SENTRY_DSN environment variable",
] as const;

/**
 * Missing required context errors (org, project, etc).
 *
 * Provides consistent error formatting with usage hints and alternatives.
 *
 * @param resource - What is required (e.g., "Organization", "Organization and project")
 * @param command - Primary usage example (e.g., "sentry org get <org-slug>")
 * @param alternatives - Alternative ways to resolve (defaults to DSN/project detection hints)
 */
export class ContextError extends CliError {
  readonly resource: string;
  readonly command: string;
  readonly alternatives: string[];

  constructor(
    resource: string,
    command: string,
    alternatives: string[] = [...DEFAULT_CONTEXT_ALTERNATIVES]
  ) {
    super(`${resource} is required.`);
    this.name = "ContextError";
    this.resource = resource;
    this.command = command;
    this.alternatives = alternatives;
  }

  override format(): string {
    const lines = [
      `${this.resource} is required.`,
      "",
      "Specify it using:",
      `  ${this.command}`,
    ];
    if (this.alternatives.length > 0) {
      lines.push("", "Or:");
      for (const alt of this.alternatives) {
        lines.push(`  - ${alt}`);
      }
    }
    return lines.join("\n");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input validation errors.
 *
 * @param message - Validation failure description
 * @param field - Name of the invalid field
 */
export class ValidationError extends CliError {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth Device Flow Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * OAuth device flow errors (RFC 8628).
 *
 * @param code - OAuth error code (e.g., "authorization_pending", "slow_down")
 * @param description - Human-readable error description
 */
export class DeviceFlowError extends CliError {
  readonly code: string;

  constructor(code: string, description?: string) {
    super(description ?? code);
    this.name = "DeviceFlowError";
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format any error for user display.
 * Uses CliError.format() for CLI errors, message for standard errors.
 *
 * @param error - Any thrown value
 * @returns Formatted error string
 */
export function formatError(error: unknown): string {
  if (error instanceof CliError) {
    return error.format();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Get process exit code for an error.
 *
 * @param error - Any thrown value
 * @returns Exit code (from CliError.exitCode or 1 for other errors)
 */
export function getExitCode(error: unknown): number {
  if (error instanceof CliError) {
    return error.exitCode;
  }
  return 1;
}
