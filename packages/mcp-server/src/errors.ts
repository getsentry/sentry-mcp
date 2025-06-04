/**
 * Error thrown when user input validation fails.
 * These errors should be returned to the user directly without logging to Sentry.
 */
export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}
