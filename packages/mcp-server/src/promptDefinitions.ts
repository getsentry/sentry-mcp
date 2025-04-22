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
];
