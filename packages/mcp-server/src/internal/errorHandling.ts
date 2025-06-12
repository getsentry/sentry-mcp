import { UserInputError } from "../errors";

/**
 * SDK Instrumentation specific error types and handling utilities.
 * Provides clear, user-friendly error messages and proper error categorization.
 */

export interface ErrorContext {
  operation: string;
  projectPath?: string;
  framework?: string;
  language?: string;
  userInput?: Record<string, any>;
  systemDetails?: Record<string, any>;
}

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
  suggestion?: string;
}

/**
 * Custom error class for project detection failures.
 */
export class ProjectDetectionError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "ProjectDetectionError";
  }
}

/**
 * Custom error class for SDK context fetching failures.
 */
export class SdkContextError extends Error {
  constructor(
    message: string,
    public readonly framework: string,
    public readonly url?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "SdkContextError";
  }
}

/**
 * Custom error class for instrumentation plan generation failures.
 */
export class InstrumentationError extends Error {
  constructor(
    message: string,
    public readonly framework: string,
    public readonly language: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "InstrumentationError";
  }
}

/**
 * Handles project detection errors with user-friendly messages.
 */
export function handleProjectDetectionError(
  error: unknown,
  context: ErrorContext
): never {
    const operation = `project detection in ${context.projectPath || "current directory"}`;

    if (error instanceof ProjectDetectionError) {
      throw new UserInputError(
        `Failed to detect project type in "${error.path}". ` +
        `${error.message} ` +
        `Please ensure you're in a valid project directory with recognizable ` +
        `dependency files (package.json, requirements.txt, go.mod, pom.xml, Cargo.toml).`
      );
    }

    if (error instanceof Error && error.message.includes("ENOENT")) {
      throw new UserInputError(
        `Directory "${context.projectPath}" does not exist or is not accessible. ` +
        `Please provide a valid project directory path.`
      );
    }

    if (error instanceof Error && error.message.includes("EACCES")) {
      throw new UserInputError(
        `Permission denied accessing directory "${context.projectPath}". ` +
        `Please check directory permissions and try again.`
      );
    }

    // Log unexpected errors for debugging
    console.error(`Unexpected error during ${operation}:`, error);
    
    throw new UserInputError(
      `Unable to detect project type in the specified directory. ` +
      `Please ensure the directory contains valid project files and try again.`
    );
  }

/**
 * Handles SDK context fetching errors with appropriate fallbacks.
 */
export function handleSdkContextError(
  error: unknown,
  context: ErrorContext
): never {
    const framework = context.framework || "unknown";

    if (error instanceof SdkContextError) {
      throw new UserInputError(
        `Failed to fetch SDK context for ${framework}: ${error.message}. ` +
        `Using built-in fallback configuration instead.`
      );
    }

    if (error instanceof Error && error.message.includes("fetch")) {
      // Network-related error - suggest fallback
      throw new UserInputError(
        `Unable to fetch latest SDK guidelines for ${framework} due to network issues. ` +
        `Proceeding with built-in SDK configuration. You may want to check the ` +
        `official Sentry documentation for the latest setup instructions.`
      );
    }

    if (error instanceof Error && error.message.includes("timeout")) {
      throw new UserInputError(
        `Request timeout while fetching SDK context for ${framework}. ` +
        `Using cached or fallback configuration instead.`
      );
    }

    // Log for debugging but don't expose technical details
    console.error(`SDK context fetch error for ${framework}:`, error);
    
    throw new UserInputError(
      `Unable to fetch the latest SDK configuration for ${framework}. ` +
      `Proceeding with default configuration.`
    );
  }

/**
 * Handles instrumentation plan generation errors.
 */
export function handleInstrumentationError(
    error: unknown,
    context: ErrorContext
  ): never {
    const framework = context.framework || "unknown";
    const language = context.language || "unknown";

    if (error instanceof InstrumentationError) {
      throw new UserInputError(
        `Failed to generate instrumentation plan for ${language}/${framework}: ` +
        `${error.message}. Please check that your project configuration is valid.`
      );
    }

    if (error instanceof UserInputError) {
      // Re-throw user input errors as-is
      throw error;
    }

    // Log unexpected errors
    console.error(`Instrumentation planning error for ${language}/${framework}:`, error);
    
    throw new UserInputError(
      `Unable to generate SDK instrumentation plan for ${language}/${framework}. ` +
      `This may be due to an unsupported project configuration. ` +
      `Please refer to the Sentry documentation for manual setup instructions.`
    );
  }

  /**
   * Handles file system operation errors.
   */
  export function handleFileSystemError(
    error: unknown,
    context: ErrorContext,
    filePath?: string
  ): never {
    const operation = context.operation;
    const path = filePath || context.projectPath || "unknown path";

    if (error instanceof Error) {
      if (error.message.includes("ENOENT")) {
        throw new UserInputError(
          `File or directory "${path}" does not exist. ` +
          `Please check the path and try again.`
        );
      }

      if (error.message.includes("EACCES")) {
        throw new UserInputError(
          `Permission denied accessing "${path}". ` +
          `Please check file/directory permissions.`
        );
      }

      if (error.message.includes("EISDIR")) {
        throw new UserInputError(
          `Expected a file but found a directory at "${path}". ` +
          `Please specify a valid file path.`
        );
      }

      if (error.message.includes("ENOTDIR")) {
        throw new UserInputError(
          `Part of the path "${path}" is not a directory. ` +
          `Please check the path structure.`
        );
      }
    }

    // Log for debugging
    console.error(`File system error during ${operation} at ${path}:`, error);
    
    throw new UserInputError(
      `Unable to ${operation} due to a file system error. ` +
      `Please check permissions and path validity.`
    );
  }

  /**
   * Handles validation errors with detailed feedback.
   */
  export function handleValidationErrors(
    errors: ValidationError[],
    context: ErrorContext
  ): void {
    if (errors.length === 0) {
      return;
    }

    const errorMessages = errors.map(error => {
      let message = `${error.field}: ${error.message}`;
      if (error.suggestion) {
        message += ` Suggestion: ${error.suggestion}`;
      }
      return message;
    });

    const operation = context.operation || "operation";
    throw new UserInputError(
      `Validation failed for ${operation}:\n` +
      errorMessages.map(msg => `• ${msg}`).join("\n") +
      `\n\nPlease correct these issues and try again.`
    );
  }

  /**
   * Validates Sentry configuration parameters.
   */
  export function validateSentryConfig(config: {
    dsn?: string;
    org?: string;
    project?: string;
    regionUrl?: string;
  }): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!config.dsn || config.dsn.trim() === "") {
      errors.push({
        field: "dsn",
        message: "Sentry DSN is required for error reporting",
        suggestion: "Create a project in Sentry and copy the DSN from project settings"
      });
    } else if (!config.dsn.includes("@") || !config.dsn.includes("ingest")) {
      errors.push({
        field: "dsn",
        message: "DSN format appears invalid",
        value: config.dsn,
        suggestion: "DSN should look like 'https://key@org.ingest.region.sentry.io/project'"
      });
    }

    if (!config.org || config.org.trim() === "") {
      errors.push({
        field: "org",
        message: "Organization slug is required",
        suggestion: "You can find your organization slug in Sentry settings"
      });
    }

    if (!config.project || config.project.trim() === "") {
      errors.push({
        field: "project",
        message: "Project slug is required",
        suggestion: "You can find your project slug in the project settings"
      });
    }

    if (config.regionUrl && !config.regionUrl.startsWith("https://")) {
      errors.push({
        field: "regionUrl",
        message: "Region URL must be a valid HTTPS URL",
        value: config.regionUrl,
        suggestion: "Use format like 'https://us.sentry.io' or 'https://eu.sentry.io'"
      });
    }

    return errors;
  }

  /**
   * Validates project directory and basic structure.
   */
  export function validateProjectDirectory(
    projectPath: string,
    requiredFiles?: string[]
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!projectPath || projectPath.trim() === "") {
      errors.push({
        field: "projectPath",
        message: "Project directory path is required",
        suggestion: "Provide the path to your project directory"
      });
      return errors;
    }

    // Additional file-based validations would go here
    // This is a placeholder for more complex validation logic

    return errors;
  }

  /**
   * Wraps async operations with proper error handling.
   */
  export function withErrorHandling<T>(
    operation: () => Promise<T>,
    context: ErrorContext
  ): Promise<T> {
    try {
      return operation();
    } catch (error) {
      switch (context.operation) {
        case "project-detection":
          handleProjectDetectionError(error, context);
          break;
        case "sdk-context-fetch":
          handleSdkContextError(error, context);
          break;
        case "instrumentation-planning":
          handleInstrumentationError(error, context);
          break;
        case "file-system":
          handleFileSystemError(error, context);
          break;
        default:
          // Generic error handling
          if (error instanceof UserInputError) {
            throw error;
          }
          console.error(`Unexpected error in ${context.operation}:`, error);
          throw new UserInputError(
            `An unexpected error occurred during ${context.operation}. ` +
            `Please try again or contact support if the issue persists.`
          );
      }
    }
  }
}

/**
 * Utility functions for error recovery and suggestions.
 */
export class ErrorRecoveryUtils {
  /**
   * Suggests recovery actions based on error type and context.
   */
  static suggestRecoveryActions(
    error: Error,
    context: ErrorContext
  ): string[] {
    const suggestions: string[] = [];

    if (error instanceof ProjectDetectionError) {
      suggestions.push(
        "Ensure you're in the root directory of your project",
        "Check that dependency files exist (package.json, requirements.txt, etc.)",
        "Verify file permissions allow reading project files",
        "Try specifying a different target directory"
      );
    }

    if (error instanceof SdkContextError) {
      suggestions.push(
        "Check your internet connection",
        "Try again in a few minutes",
        "Proceed with manual SDK setup using Sentry documentation",
        "Use a different framework if this one is not supported"
      );
    }

    if (error instanceof InstrumentationError) {
      suggestions.push(
        "Verify your project uses a supported framework version",
        "Check that all required project files are present",
        "Try selecting a different framework option",
        "Refer to Sentry documentation for manual setup"
      );
    }

    if (error.message.toLowerCase().includes("permission")) {
      suggestions.push(
        "Check file/directory permissions",
        "Run the command with appropriate privileges",
        "Ensure the target directory is writable"
      );
    }

    if (error.message.toLowerCase().includes("network") || error.message.toLowerCase().includes("fetch")) {
      suggestions.push(
        "Check your internet connection",
        "Verify firewall settings allow HTTPS requests",
        "Try again later if service is temporarily unavailable"
      );
    }

    // Always include general suggestions
    suggestions.push(
      "Review the error message for specific guidance",
      "Consult the Sentry documentation for your platform",
      "Reach out to Sentry support if issues persist"
    );

    return suggestions;
  }

  /**
   * Formats error for user display with recovery suggestions.
   */
  static formatErrorWithRecovery(
    error: Error,
    context: ErrorContext
  ): string {
    const recoveryActions = this.suggestRecoveryActions(error, context);
    
    let message = error.message;
    
    if (recoveryActions.length > 0) {
      message += "\n\n🔧 **Suggested actions:**\n";
      message += recoveryActions.map(action => `• ${action}`).join("\n");
    }

    return message;
  }
} 
