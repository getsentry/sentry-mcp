/**
 * Prompt definitions for the Sentry MCP server.
 *
 * Declarative definitions for all MCP prompts that provide multi-step workflows
 * and guided interactions with Sentry. Prompts orchestrate sequences of tool calls
 * with structured guidance for complex tasks.
 *
 * @example Prompt Definition Structure
 * ```typescript
 * {
 *   name: "prompt_name" as const,
 *   description: [
 *     "Brief prompt description and purpose.",
 *     "Additional context about when to use this prompt.",
 *   ].join("\n"),
 *   paramsSchema: {
 *     organizationSlug: ParamOrganizationSlug,
 *     optionalParam: ParamSchema.optional(),
 *   },
 * }
 * ```
 */
import { z } from "zod";
import {
  ParamIssueShortId,
  ParamIssueUrl,
  ParamOrganizationSlug,
} from "./schema";

/**
 * All MCP prompt definitions for the Sentry server.
 *
 * Used by server.ts to register prompts with the MCP server and by prompts.ts
 * for implementation handlers. Each definition includes name, description, and
 * Zod parameter schema for multi-step workflows.
 */
export const PROMPT_DEFINITIONS = [
  {
    name: "find_errors_in_file" as const,
    description: [
      "Use this prompt when you need to find errors in Sentry for a given file.",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug,
      filename: z.string().describe("The filename to search for errors in."),
    },
  },
  {
    name: "fix_issue_with_seer" as const,
    description: [
      "Use this prompt when you need to fix an issue with Seer.",
      "You can pass in either an `issueId` and `organizationSlug`, or an `issueUrl`.",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      issueId: ParamIssueShortId,
      issueUrl: ParamIssueUrl,
    },
  },
];
