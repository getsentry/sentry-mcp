import type { PromptHandlers } from "./types";

export const PROMPT_HANDLERS = {
  find_errors_in_file: async ({ organizationSlug, filename }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `I want to find errors in Sentry, within the organization ${organizationSlug}, for the file ${filename}`,
            "",
            "You should use the tool `search_errors` to find errors in Sentry.",
            "",
            "If the filename is ambiguous, such as something like `index.ts`, and in most cases, you should pass it in with its direct parent.",
            "For example: if the file is `app/utils/index.ts`, you should pass in `utils/index.ts` or `app/utils/index.ts` depending on if the file is actually part of the applications source path.",
          ].join("\n"),
        },
      },
    ],
  }),
} satisfies PromptHandlers;
