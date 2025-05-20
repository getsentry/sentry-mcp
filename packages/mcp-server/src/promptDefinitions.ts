import { z } from "zod";
import { ParamOrganizationSlug } from "./schema";

export const PROMPT_DEFINITIONS = [
  {
    name: "find_errors_in_file" as const,
    description: [
      "Use this prompt when you need to find errors in Sentry for a given file.",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug,
      filename: z.string(),
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
      issueId: z.string().optional(),
      issueUrl: z.string().optional(),
    },
  },
];
