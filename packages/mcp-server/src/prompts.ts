/**
 * Prompt implementation handlers for the Sentry MCP server.
 *
 * Contains runtime implementations for all MCP prompts defined in `promptDefinitions.ts`.
 * Each handler generates context-aware instructions that guide LLMs through
 * complex multi-step workflows involving Sentry operations.
 *
 * @example Basic Handler Pattern
 * ```typescript
 * prompt_name: async (context, params) => {
 *   const instructions = [
 *     "Primary objective and context",
 *     "",
 *     "1. First step with specific tool call",
 *     "2. Second step with conditional logic",
 *     "3. Final step with recommendations",
 *   ];
 *   return instructions.join("\n");
 * },
 * ```
 */
import { UserInputError } from "./errors";
import type { PromptHandlers } from "./types";

export const PROMPT_HANDLERS = {
  find_errors_in_file: async (context, { organizationSlug, filename }) =>
    [
      `I want to find errors in Sentry, within the organization ${organizationSlug}, for the file ${filename}`,
      "",
      "You should use the tool `search_errors` to find errors in Sentry.",
      "",
      "If the filename is ambiguous, such as something like `index.ts`, and in most cases, you should pass it in with its direct parent.",
      "For example: if the file is `app/utils/index.ts`, you should pass in `utils/index.ts` or `app/utils/index.ts` depending on if the file is actually part of the applications source path.",
    ].join("\n"),
  fix_issue_with_seer: async (
    context,
    { organizationSlug, issueId, issueUrl },
  ) => {
    let issueMessage: string;
    if (issueUrl) {
      issueMessage = `The Sentry issue is ${issueUrl}`;
    } else if (organizationSlug && issueId) {
      issueMessage = `The Sentry issue is ${issueId} in the organization ${organizationSlug}`;
    } else {
      throw new UserInputError(
        "Either issueUrl or organizationSlug and issueId must be provided",
      );
    }
    return [
      `I want to use Seer to fix an issue in Sentry.`,
      "",
      issueMessage,
      "",
      "1. Call the tool `get_seer_issue_fix_status` to see if its already in progress.",
      "2a. If it isn't, you can start it with the tool `begin_seer_issue_fix`.",
      "2b. If it is, you can call the tool `get_seer_issue_fix_status` to check the status of the analysis.",
      "3. Repeat step 2b until the task has completed.",
      "4. Help me apply the fix to my application, if you are able to. Think carefully when doing this.",
    ].join("\n");
  },
} satisfies PromptHandlers;
