import { ApiNotFoundError } from "../../api-client";

/**
 * Enhances a 404 error with parameter context to help users understand what went wrong.
 * This is optional - tools can use this when they want to provide extra context.
 *
 * @example
 * ```typescript
 * try {
 *   const issue = await apiService.getIssue({ organizationSlug, issueId });
 * } catch (error) {
 *   if (error instanceof ApiNotFoundError) {
 *     throw enhanceNotFoundError(error, { organizationSlug, issueId });
 *   }
 *   throw error;
 * }
 * ```
 */
export function enhanceNotFoundError(
  error: ApiNotFoundError,
  params: Record<string, unknown>,
): ApiNotFoundError {
  const paramsList: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      paramsList.push(`${key}: '${value}'`);
    }
  }

  if (paramsList.length > 0) {
    const enhancedMessage = `${error.message}\nPlease verify these parameters are correct:\n${paramsList.map((p) => `  - ${p}`).join("\n")}`;
    return new ApiNotFoundError(
      enhancedMessage,
      error.detail,
      error.responseBody,
    );
  }

  return error;
}
