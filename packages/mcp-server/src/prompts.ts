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
      "You should use the tool `search_events` with a natural language query to find errors in Sentry.",
      "",
      `For example: \`search_events(organizationSlug='${organizationSlug}', naturalLanguageQuery='errors in file ${filename}')\``,
      "",
      "If the filename is ambiguous, such as something like `index.ts`, and in most cases, you should include its direct parent.",
      "For example: if the file is `app/utils/index.ts`, you should search for `errors in file utils/index.ts` or `errors in file app/utils/index.ts` depending on if the file is actually part of the applications source path.",
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
      "1. Call the tool `analyze_issue_with_seer` to analyze the issue and get fix recommendations.",
      "2. The tool will automatically check for existing analysis or start a new one if needed.",
      "3. Wait for the analysis to complete (typically 30-60 seconds).",
      "4. Review the root cause analysis and suggested fixes.",
      "5. Help me apply the fix to my application, if you are able to. Think carefully when doing this.",
    ].join("\n");
  },
} satisfies PromptHandlers;
