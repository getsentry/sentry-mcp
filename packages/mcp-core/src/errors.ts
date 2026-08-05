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
 * Error thrown when an LLM provider (OpenAI, Anthropic, OpenRouter, etc.) rejects
 * or cannot complete a request due to availability issues: region restrictions,
 * budget/quota exhaustion, rate limits, or provider outages.
 * These errors should be returned as graceful tool failures and logged as
 * warnings — not filed as per-request Sentry issues.
 */
export class LLMProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LLMProviderError";
  }
}
