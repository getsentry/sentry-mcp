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

export type AgentExecutionErrorOptions = ErrorOptions & {
  /**
   * Sentry event id from the single logIssue call that already reported this
   * unexpected agent failure. Downstream handlers must not file another issue.
   */
  eventId?: string;
};

/**
 * Unexpected failure inside an embedded agent run (for example the AI SDK
 * finishing without structured output).
 *
 * These are real bugs/operational defects and MUST create a Sentry issue once
 * at the agent boundary. Callers should still degrade gracefully (fallback or
 * formatted tool error) instead of hard-failing the parent MCP tool. The issue
 * is filed before this error is thrown; do not call logIssue again for it.
 */
export class AgentExecutionError extends Error {
  readonly eventId?: string;

  constructor(message: string, options?: AgentExecutionErrorOptions) {
    super(message, options);
    this.name = "AgentExecutionError";
    this.eventId = options?.eventId;
  }
}
