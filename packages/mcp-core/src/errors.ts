/**
 * Error thrown when user input validation fails.
 * These errors should be returned to the user directly without logging to Sentry.
 */
export class UserInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UserInputError";
  }
}

/**
 * Error thrown when configuration is invalid or missing.
 * These errors should be returned to the user directly without logging to Sentry.
 * Typically used for environment configuration issues, connection settings, etc.
 */
export class ConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigurationError";
  }
}

/**
 * Error thrown when an LLM provider (OpenAI, Anthropic, etc.) rejects a request
 * due to service availability issues like region restrictions.
 * These errors should be returned to the user directly without logging to Sentry.
 */
export class LLMProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LLMProviderError";
  }
}
