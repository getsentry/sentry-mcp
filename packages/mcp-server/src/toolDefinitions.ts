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
    name: "list_issues" as const,
    description: [
      "List all issues in Sentry.",
      "",
      "Use this tool when you need to:",
      "- View all issues in a Sentry organization",
      "",
      "If you're looking for more granular data beyond a summary of identified problems, you should use the `search_errors()` or `search_transactions()` tools instead.",
      "<examples>",
      "### Find the newest unresolved issues in the 'my-project' project",
      "",
      "```",
      "list_issues(organizationSlug='my-organization', projectSlug='my-project', query='is:unresolved', sortBy='last_seen')",
      "```",
      "",
      "### Find the most frequently occurring crashes in the 'my-project' project",
      "",
      "```",
      "list_issues(organizationSlug='my-organization', projectSlug='my-project', query='is:unresolved error.handled:false', sortBy='count')",
      "```",
      "",
      "### Find the oldest unresolved issues in the 'my-project' project",
      "",
      "```",
      "list_issues(organizationSlug='my-organization', projectSlug='my-project', query='is:unresolved', sortBy='first_seen')",
      "```",
      "</examples>",
      "",
      "<query_syntax>",
      "Use the tool `help('query_syntax')` to get more information about the query syntax.",
      "",
      "There are some common query parameters that are useful for searching issues:",
      "",
      "- `is:unresolved` - Find unresolved issues",
      "- `is:unassigned` - Find untriaged issues",
      "- `assigned:me` - Find issues assigned to you",
      "- `issue.category:performance` - Find performance issues",
      "- `issue.priority:high` - Find high priority issues",
      "- `release:[1.0, 2.0]` - Find issues in specific releases",
      "- `release:latest` - Find issues in the latest release only",
      "- `stack.filename:relative/path/file.ts - Find issues related to a given file, with the filename being a relative path from the root (in the stacktrace).",
      "- `trace:TRACE_ID` - Find issues matching a specific trace ID",
      "- `transaction:*/checkout` - Find errors affecting a specific route",
      "- `user.email:foo@example.com` - Find issues affecting a specific user",
      "- `USER_DEFINED_TAG:value` - Find issues related to a user-defined tag",
      "",
      "In most cases when a user asks for a list of issues, they are asking for a list of _unresolved_ issues (`is:unresolved`).",
      "</query_syntax>",
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
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      issueId: ParamIssueShortId.optional(),
      issueUrl: z.string().url().optional(),
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
      "<query_syntax>",
      "Use the tool `help('query_syntax')` to get more information about the query syntax.",
      "",
      "There are some common query parameters that are useful for searching errors:",
      "",
      "- `error.handled:false` - Find errors that are not handled (otherwise known as uncaught exceptions or crashes)",
      "- `release:[1.0, 2.0]` - Find errors in a specific release",
      "- `release:latest` - Find errors in the latest release only",
      "- `user.email:david@example.com` - Find errors affecting a specific user",
      "- `transaction:/checkout` - Find errors affecting a specific route",
      "</query_syntax>",
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
      // "",
      // "<query_syntax>",
      // "Use the tool `help('query_syntax')` to get more information about the query syntax.",
      // "",
      // "There are some common query parameters that are useful for searching errors:",
      // "",
      // "- `is:unresolved` - Find unresolved errors",
      // "- `error.handled:false` - Find errors that are not handled (otherwise known as uncaught exceptions or crashes)",
      // "</query_syntax>",
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
    name: "help" as const,
    description: [
      "Get information to help you better work with Sentry.",
      "",
      "Use this tool when you need to:",
      "- Understand the Sentry search syntax",
      "",
      "<examples>",
      "### Get help with the Sentry search syntax",
      "",
      "```",
      "help('query_syntax')",
      "```",
      "</examples>",
    ].join("\n"),
    paramsSchema: {
      subject: z
        .enum(["query_syntax"])
        .describe("The subject to get help with."),
    },
  },
];
