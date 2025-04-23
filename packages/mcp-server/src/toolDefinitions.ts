// TODO: this gets imported by the client code and thus is separated from server code
// to avoid bundling issues. We'd like to find a better solution that isnt so brittle and keeps this code co-located w/ its tool calls.
import {
  ParamOrganizationSlug,
  ParamIssueShortId,
  ParamTeamSlug,
  ParamPlatform,
  ParamProjectSlug,
  ParamQuery,
  ParamTransaction,
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
      "- Find an organization's slug to aid other tool requests",
    ].join("\n"),
  },
  {
    name: "list_teams" as const,
    description: [
      "List all teams in an organization in Sentry.",
      "",
      "Use this tool when you need to:",
      "- View all teams in a Sentry organization",
      "- Find an team's slug to aid other tool requests",
      "",
      "<hints>",
      "- If you're uncertain about which organization to query, you should call `list_organizations()` first.",
      "</hints>",
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
      "- Find an project's slug to aid other tool requests",
      "",
      "<hints>",
      "- If you're uncertain about which organization to query, you should call `list_organizations()` first.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
    },
  },
  {
    name: "list_issues" as const,
    description: [
      "List all issues in Sentry.",
      "",
      "Use this tool when you need to:",
      "- View all issues in a Sentry organization",
      "",
      "If you're looking for more granular data beyond a summary of identified problems, you should use the `search_errors()` or `search_transactions()` tools instead.",
      "",
      "<examples>",
      "### Find the newest unresolved issues across 'my-organization'",
      "",
      "```",
      "list_issues(organizationSlug='my-organization', query='is:unresolved', sortBy='last_seen')",
      "```",
      "",
      "### Find the most frequently occurring crashes in the 'my-project' project",
      "",
      "```",
      "list_issues(organizationSlug='my-organization', projectSlug='my-project', query='is:unresolved error.handled:false', sortBy='count')",
      "```",
      "",
      "</examples>",
      "",
      "<hints>",
      "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectSlug>.",
      "- If only one parameter is provided, and it could be either `organizationSlug` or `projectSlug`, its probably `organizationSlug`, but if you're really uncertain you should call `list_organizations()` first.",
      "- You can use the `list_tags()` tool to see what user-defined tags are available.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      projectSlug: ParamProjectSlug.optional(),
      query: ParamQuery.optional(),
      sortBy: z
        .enum(["last_seen", "first_seen", "count", "userCount"])
        .describe(
          "Sort the results either by the last time they occurred, the first time they occurred, the count of occurrences, or the number of users affected.",
        )
        .optional(),
    },
  },
  {
    name: "list_releases" as const,
    description: [
      "List all releases in Sentry.",
      "",
      "Use this tool when you need to:",
      "- Find recent releases in a Sentry organization",
      "- Find the most recent version released of a specific project",
      "- Determine when a release was deployed to an environment",
      "<hints>",
      "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectSlug>.",
      "- If only one parameter is provided, and it could be either `organizationSlug` or `projectSlug`, its probably `organizationSlug`, but if you're really uncertain you should call `list_organizations()` first.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      projectSlug: ParamProjectSlug.optional(),
    },
  },
  {
    name: "list_tags" as const,
    description: [
      "List all tags in Sentry.",
      "",
      "Use this tool when you need to:",
      "- Find tags available to use in searches",
      "",
      "<hints>",
      "- If you're uncertain about which organization to query, you should call `list_organizations()` first.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
    },
  },
  {
    name: "get_issue_summary" as const,
    description: [
      "Retrieve a summary of an issue in Sentry.",
      "",
      "Use this tool when you need to:",
      "- View a summary of an issue in Sentry",
      "",
      "If the issue is an error, or you want additional information like the stacktrace, you should use `get_issue_details()` tool instead.",
      "",
      "<hints>",
      "- If the user provides the issueUrl, you can ignore the organizationSlug and issueId parameters.",
      "- If you're uncertain about which organization to query, you should call `list_organizations()` first. This especially important if an issueId is passed.",
      "</hints>",
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
    name: "get_issue_details" as const,
    description: [
      "Retrieve issue details from Sentry for a specific Issue ID, including the stacktrace and error message if available. Either issueId or issueUrl MUST be provided.",
      "",
      "Use this tool when you need to:",
      "- Investigate a specific production error",
      "- Access detailed error information and stacktraces from Sentry",
      "",
      "<hints>",
      "- If the user provides the issueUrl, you can ignore the organizationSlug and issueId parameters.",
      "- If you're uncertain about which organization to query, you should call `list_organizations()` first. This especially important if an issueId is passed.",
      "</hints>",
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
      "Query Sentry for errors using advanced search syntax.",
      "",
      "Use this tool when you need to:",
      "- Search for production errors in a specific file.",
      "- Analyze error patterns and frequencies.",
      "- Find recent or frequently occurring errors.",
      "",
      "<examples>",
      "### Find common errors within a file",
      "",
      "To find common errors within a file, you can use the `filename` parameter. This is a suffix based search, so only using the filename or the direct parent folder of the file. The parent folder is preferred when the filename is in a subfolder or a common filename. If you provide generic filenames like `index.js` you're going to end up finding errors that are might be from completely different projects.",
      "",
      "```",
      "search_errors(organizationSlug='my-organization', filename='index.js', sortBy='count')",
      "```",
      "",
      "### Find recent crashes from the 'peated' project",
      "",
      "```",
      "search_errors(organizationSlug='my-organization', query='is:unresolved error.handled:false', projectSlug='peated', sortBy='last_seen')",
      "```",
      "",
      "</examples>",
      "",
      "<hints>",
      "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectSlug>.",
      "- If only one parameter is provided, and it could be either `organizationSlug` or `projectSlug`, its probably `organizationSlug`, but if you're really uncertain you should call `list_organizations()` first.",
      "- If you are looking for issues, in a way that you might be looking for something like 'unresolved errors', you should use the `list_issues()` tool",
      "- You can use the `list_tags()` tool to see what user-defined tags are available.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      projectSlug: ParamProjectSlug.optional(),
      filename: z
        .string()
        .describe("The filename to search for errors in.")
        .optional(),
      transaction: ParamTransaction.optional(),
      query: ParamQuery.optional(),
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
    name: "search_transactions" as const,
    description: [
      "Query Sentry for transactions using advanced search syntax.",
      "",
      "Transactions are segments of traces that are associated with a specific route or endpoint.",
      "",
      "Use this tool when you need to:",
      "- Search for production transaction data to understand performance.",
      "- Analyze traces and latency patterns.",
      "- Find examples of recent requests to endpoints.",
      "",
      "<examples>",
      "### Find slow requests to a route",
      "",
      "...",
      "",
      "```",
      "search_transactions(organizationSlug='my-organization', transaction='/checkout', sortBy='latency')",
      "```",
      "",
      "</examples>",
      "",
      "<hints>",
      "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectSlug>.",
      "- If only one parameter is provided, and it could be either `organizationSlug` or `projectSlug`, its probably `organizationSlug`, but if you're really uncertain you might want to call `list_organizations()` first.",
      "- You can use the `list_tags()` tool to see what user-defined tags are available.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      projectSlug: ParamProjectSlug.optional(),
      transaction: ParamTransaction.optional(),
      query: ParamQuery.optional(),
      sortBy: z
        .enum(["timestamp", "duration"])
        .optional()
        .default("timestamp")
        .describe(
          "Sort the results either by the timestamp of the request (most recent first) or the duration of the request (longest first).",
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
      "",
      "<hints>",
      "- If any parameter is ambiguous, you should clarify with the user what they meant.",
      "</hints>",
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
      "",
      "<examples>",
      "### Create a new javascript project in the 'my-organization' organization",
      "",
      "```",
      "create_project(organizationSlug='my-organization', teamSlug='my-team', name='my-project', platform='javascript')",
      "```",
      "",
      "</examples>",
      "",
      "<hints>",
      "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<teamSlug>.",
      "- If any parameter is ambiguous, you should clarify with the user what they meant.",
      "</hints>",
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
    name: "create_dsn" as const,
    description: [
      "Create a new DSN for a specific project.",
      "",
      "Use this tool when you need to:",
      "- Create a new DSN for a specific project",
      "",
      "<examples>",
      "### Create a new DSN for the 'my-project' project",
      "",
      "```",
      "create_dsn(organizationSlug='my-organization', projectSlug='my-project', name='Default')",
      "```",
      "",
      "</examples>",
      "",
      "<hints>",
      "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectSlug>.",
      "- If any parameter is ambiguous, you should clarify with the user what they meant.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      projectSlug: ParamProjectSlug,
      name: z.string().describe("The name of the DSN to create."),
    },
  },
  {
    name: "list_dsns" as const,
    description: [
      "List all DSNs for a specific project.",
      "",
      "Use this tool when you need to:",
      "- Retrieve a SENTRY_DSN for a specific project",
      "",
      "<hints>",
      "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectSlug>.",
      "- If only one parameter is provided, and it could be either `organizationSlug` or `projectSlug`, its probably `organizationSlug`, but if you're really uncertain you might want to call `list_organizations()` first.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      projectSlug: ParamProjectSlug,
    },
  },
  {
    name: "begin_autofix" as const,
    description: [
      "Analyze an issue in Sentry, identify a root cause, and suggest a fix for it.",
      "",
      "Use this tool when you need to:",
      "- Determine the root cause of an issue.",
      "- Generate a plan for fixing an issue.",
      "- Implement a fix for an issue.",
      "",
      "This operation may take some time, so you should call `get_autofix_status()` to check the status of the analysis after you begin it.",
      "",
      "<examples>",
      "### Analyze and propose a fix for 'ISSUE-123' in Sentry",
      "",
      "```",
      "begin_autofix(organizationSlug='my-organization', issueId='ISSUE-123')",
      "```",
      "</examples>",
      "",
      "<hints>",
      "- Always check to see if an autofix is in progress for before calling this tool by using `get_autofix_status()`.",
      "- If the user provides the issueUrl, you can ignore the organizationSlug and issueId parameters.",
      "- If you're uncertain about which organization to query, you should call `list_organizations()` first. This especially important if an issueId is passed.",
      "</hints>",
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
    name: "get_autofix_status" as const,
    description: [
      "Get the status of a root cause analysis for an issue in Sentry.",
      "",
      "Use this tool when you need to:",
      "- Get the root cause analysis for an issue.",
      "- Get the status of a fix for an issue.",
      "",
      "<examples>",
      "### Get the status of a fix for the 'ISSUE-123' issue",
      "",
      "```",
      "get_autofix_status(organizationSlug='my-organization', issueId='ISSUE-123')",
      "```",
      "",
      "</examples>",
      "",
      "<hints>",
      "- If the user provides the issueUrl, you can ignore the organizationSlug and issueId parameters.",
      "- If you're uncertain about which organization to query, you should call `list_organizations()` first. This especially important if an issueId is passed.",
      "</hints>",
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
];
