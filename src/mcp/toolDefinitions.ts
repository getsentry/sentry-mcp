// TODO: this gets imported by the client code (src/web) and thus is separated from server code
// to avoid bundling issues. We'd like to find a better solution that isnt so brittle and keeps this code co-located w/ its tool calls.
import {
  ParamOrganizationSlug,
  ParamIssueShortId,
  ParamTeamSlug,
  ParamPlatform,
} from "./schema";
import { z } from "zod";

export const TOOL_DEFINITIONS = [
  {
    name: "list_organizations" as const,
    description: [
      "List all organizations that the user has access to in Sentry.",
      "",
      "Use this tool when you need to:",
      "- View all organizations in Sentry",
    ].join("\n"),
  },
  {
    name: "list_teams" as const,
    description: [
      "List all teams in an organization in Sentry.",
      "",
      "Use this tool when you need to:",
      "- View all teams in a Sentry organization",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
    },
  },
  {
    name: "list_projects" as const,
    description: [
      "Retrieve a list of projects in Sentry.",
      "",
      "Use this tool when you need to:",
      "- View all projects in a Sentry organization",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
    },
  },
  {
    name: "get_error_details" as const,
    description: [
      "Retrieve error details from Sentry for a specific Issue ID, including the stacktrace and error message. Either issueId or issueUrl MUST be provided.",
      "",
      "Use this tool when you need to:",
      "- Investigate a specific production error",
      "- Access detailed error information and stacktraces from Sentry",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      issueId: ParamIssueShortId.optional(),
      issueUrl: z
        .string()
        .url()
        .describe("The URL of the issue to retrieve details for.")
        .optional(),
    },
  },
  {
    name: "search_errors" as const,
    description: [
      "Search for errors in Sentry.",
      "",
      "Use this tool when you need to:",
      "- Search for production errors in a specific file",
      "- Analyze error patterns and frequencies",
      "- Find recent or frequently occurring errors.",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      filename: z
        .string()
        .describe(
          "The filename to search for errors in. This is a suffix based search, so only using the filename or the direct parent folder of the file. The parent folder is preferred when the filename is in a subfolder or a common filename.",
        )
        .optional(),
      query: z
        .string()
        .describe(
          `The search query to apply. Use the \`help\` tool to get more information about the query syntax rather than guessing.`,
        )
        .optional(),
      sortBy: z
        .enum(["last_seen", "count"])
        .optional()
        .default("last_seen")
        .describe(
          "Sort the results either by the last time they occurred or the count of occurrences.",
        ),
    },
  },
  {
    name: "create_team" as const,
    description: [
      "Create a new team in Sentry.",
      "",
      "Use this tool when you need to:",
      "- Create a new team in a Sentry organization",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      name: z.string().describe("The name of the team to create."),
    },
  },
  {
    name: "create_project" as const,
    description: [
      "Create a new project in Sentry, giving you access to a new SENTRY_DSN.",
      "",
      "Use this tool when you need to:",
      "- Create a new project in a Sentry organization",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      teamSlug: ParamTeamSlug,
      name: z
        .string()
        .describe(
          "The name of the project to create. Typically this is commonly the name of the repository or service. It is only used as a visual label in Sentry.",
        ),
      platform: ParamPlatform.optional(),
    },
  },
  {
    name: "help" as const,
    description: [
      "Get information to help you better work with Sentry.",
      "",
      "Use this tool when you need to:",
      "- Understand the Sentry search syntax",
    ].join("\n"),
    paramsSchema: {
      subject: z
        .enum(["query_syntax"])
        .describe("The subject to get help with."),
    },
  },
];
