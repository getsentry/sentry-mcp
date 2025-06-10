/**
 * Tool definitions for the Sentry MCP server.
 *
 * Declarative definitions for all MCP tools that interface with Sentry's API.
 * Each tool definition includes its name, description, parameter schema, and
 * documentation for LLM consumption.
 *
 * @example Tool Definition Structure
 * ```typescript
 * {
 *   name: "tool_name" as const,
 *   description: [
 *     "Brief tool description.",
 *     "",
 *     "Use this tool when you need to:",
 *     "- Specific use case 1",
 *     "- Specific use case 2",
 *   ].join("\n"),
 *   paramsSchema: {
 *     organizationSlug: ParamOrganizationSlug,
 *     optionalParam: ParamSchema.optional(),
 *   },
 * }
 * ```
 */

// TODO: this gets imported by the client code and thus is separated from server code
// to avoid bundling issues. We'd like to find a better solution that isnt so brittle and keeps this code co-located w/ its tool calls.
import {
  ParamOrganizationSlug,
  ParamIssueShortId,
  ParamPlatform,
  ParamProjectSlug,
  ParamQuery,
  ParamTransaction,
  ParamRegionUrl,
  ParamProjectSlugOrAll,
  ParamIssueUrl,
  ParamTeamSlug,
  ParamIssueStatus,
  ParamAssignedTo,
} from "./schema";
import { z } from "zod";

/**
 * All MCP tool definitions for the Sentry server.
 *
 * Used by server.ts to register tools with the MCP server and by tools.ts
 * to validate parameters. Each definition includes name, description, and
 * Zod parameter schema.
 */
export const TOOL_DEFINITIONS = [
  {
    name: "whoami" as const,
    description: [
      "Identify the authenticated user in Sentry.",
      "",
      "Use this tool when you need to:",
      "- Get the user's name and email address.",
    ].join("\n"),
    paramsSchema: {
      regionUrl: ParamRegionUrl.optional(),
    },
  },
  {
    name: "find_organizations" as const,
    description: [
      "Find organizations that the user has access to in Sentry.",
      "",
      "Use this tool when you need to:",
      "- View all organizations in Sentry",
      "- Find an organization's slug to aid other tool requests",
    ].join("\n"),
    paramsSchema: {
      regionUrl: ParamRegionUrl.optional(),
    },
  },
  {
    name: "find_teams" as const,
    description: [
      "Find teams in an organization in Sentry.",
      "",
      "Use this tool when you need to:",
      "- View all teams in a Sentry organization",
      "- Find a team's slug to aid other tool requests",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug,
      regionUrl: ParamRegionUrl.optional(),
    },
  },
  {
    name: "find_projects" as const,
    description: [
      "Find projects in Sentry.",
      "",
      "Use this tool when you need to:",
      "- View all projects in a Sentry organization",
      "- Find a project's slug to aid other tool requests",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug,
      regionUrl: ParamRegionUrl.optional(),
    },
  },
  {
    name: "find_issues" as const,
    description: [
      "Find issues in Sentry.",
      "",
      "Use this tool when you need to:",
      "- View all issues in a Sentry organization",
      "",
      "If you're looking for more granular data beyond a summary of identified problems, you should use the `find_errors()` or `find_transactions()` tools instead.",
      "",
      "<examples>",
      "### Find the newest unresolved issues across 'my-organization'",
      "",
      "```",
      "find_issues(organizationSlug='my-organization', query='is:unresolved', sortBy='last_seen')",
      "```",
      "",
      "### Find the most frequently occurring crashes in the 'my-project' project",
      "",
      "```",
      "find_issues(organizationSlug='my-organization', projectSlug='my-project', query='is:unresolved error.handled:false', sortBy='count')",
      "```",
      "",
      "</examples>",
      "",
      "<hints>",
      "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectSlug>.",
      "- You can use the `find_tags()` tool to see what user-defined tags are available.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug,
      regionUrl: ParamRegionUrl.optional(),
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
    name: "find_releases" as const,
    description: [
      "Find releases in Sentry.",
      "",
      "Use this tool when you need to:",
      "- Find recent releases in a Sentry organization",
      "- Find the most recent version released of a specific project",
      "- Determine when a release was deployed to an environment",
      "",
      "<examples>",
      "### Find the most recent releases in the 'my-organization' organization",
      "",
      "```",
      "find_releases(organizationSlug='my-organization')",
      "```",
      "",
      "### Find releases matching '2ce6a27' in the 'my-organization' organization",
      "",
      "```",
      "find_releases(organizationSlug='my-organization', query='2ce6a27')",
      "```",
      "</examples>",
      "",
      "<hints>",
      "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectSlug>.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug,
      regionUrl: ParamRegionUrl.optional(),
      projectSlug: ParamProjectSlugOrAll.optional(),
      query: z
        .string()
        .trim()
        .describe("Search for versions which contain the provided string.")
        .optional(),
    },
  },
  {
    name: "find_tags" as const,
    description: [
      "Find tags in Sentry.",
      "",
      "Use this tool when you need to:",
      "- Find tags available to use in search queries (such as `find_issues()` or `find_errors()`)",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug,
      regionUrl: ParamRegionUrl.optional(),
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
      "<examples>",
      "### Get details for issue ID 'CLOUDFLARE-MCP-41'",
      "",
      "```",
      "get_issue_details(organizationSlug='my-organization', issueId='CLOUDFLARE-MCP-41')",
      "```",
      "",
      "### Get details for event ID 'c49541c747cb4d8aa3efb70ca5aba243'",
      "",
      "```",
      "get_issue_details(organizationSlug='my-organization', eventId='c49541c747cb4d8aa3efb70ca5aba243')",
      "```",
      "</examples>",

      "<hints>",
      "- If the user provides the `issueUrl`, you can ignore the other parameters.",
      "- If the user provides `issueId` or `eventId` (only one is needed), `organizationSlug` is required.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      regionUrl: ParamRegionUrl.optional(),
      issueId: ParamIssueShortId.optional(),
      eventId: z.string().trim().describe("The ID of the event.").optional(),
      issueUrl: ParamIssueUrl.optional(),
    },
  },
  {
    name: "update_issue" as const,
    description: [
      "Update an issue's status or assignment in Sentry. This allows you to resolve, ignore, or reassign issues.",
      "",
      "Use this tool when you need to:",
      "- Resolve an issue that has been fixed",
      "- Assign an issue to a team member or team for investigation",
      "- Mark an issue as ignored to reduce noise",
      "- Reopen a resolved issue by setting status to 'unresolved'",
      "",
      "<examples>",
      "### Resolve an issue",
      "",
      "```",
      "update_issue(organizationSlug='my-organization', issueId='PROJECT-123', status='resolved')",
      "```",
      "",
      "### Assign an issue to a user",
      "",
      "```",
      "update_issue(organizationSlug='my-organization', issueId='PROJECT-123', assignedTo='john.doe')",
      "```",
      "",
      "### Resolve an issue and assign it to yourself",
      "",
      "```",
      "update_issue(organizationSlug='my-organization', issueId='PROJECT-123', status='resolved', assignedTo='me')",
      "```",
      "",
      "### Mark an issue as ignored",
      "",
      "```",
      "update_issue(organizationSlug='my-organization', issueId='PROJECT-123', status='ignored')",
      "```",
      "",
      "</examples>",
      "",
      "<hints>",
      "- If the user provides the `issueUrl`, you can ignore the other required parameters and extract them from the URL.",
      "- At least one of `status` or `assignedTo` must be provided to update the issue.",
      "- Use 'me' as the value for `assignedTo` to assign the issue to the authenticated user.",
      "- Valid status values are: 'resolved', 'resolvedInNextRelease', 'unresolved', 'ignored'.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      regionUrl: ParamRegionUrl.optional(),
      issueId: ParamIssueShortId.optional(),
      issueUrl: ParamIssueUrl.optional(),
      status: ParamIssueStatus.optional(),
      assignedTo: ParamAssignedTo.optional(),
    },
  },
  {
    name: "find_errors" as const,
    description: [
      "Find errors in Sentry using advanced search syntax.",
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
      "find_errors(organizationSlug='my-organization', filename='index.js', sortBy='count')",
      "```",
      "",
      "### Find recent crashes from the 'peated' project",
      "",
      "```",
      "find_errors(organizationSlug='my-organization', query='is:unresolved error.handled:false', projectSlug='peated', sortBy='last_seen')",
      "```",
      "",
      "</examples>",
      "",
      "<hints>",
      "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectSlug>.",
      "- If only one parameter is provided, and it could be either `organizationSlug` or `projectSlug`, its probably `organizationSlug`, but if you're really uncertain you should call `find_organizations()` first.",
      "- If you are looking for issues, in a way that you might be looking for something like 'unresolved errors', you should use the `find_issues()` tool",
      "- You can use the `find_tags()` tool to see what user-defined tags are available.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug,
      regionUrl: ParamRegionUrl.optional(),
      projectSlug: ParamProjectSlugOrAll.optional(),
      filename: z
        .string()
        .trim()
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
    name: "find_transactions" as const,
    description: [
      "Find transactions in Sentry using advanced search syntax.",
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
      "find_transactions(organizationSlug='my-organization', transaction='/checkout', sortBy='duration')",
      "```",
      "",
      "</examples>",
      "",
      "<hints>",
      "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectSlug>.",
      "- If only one parameter is provided, and it could be either `organizationSlug` or `projectSlug`, its probably `organizationSlug`, but if you're really uncertain you might want to call `find_organizations()` first.",
      "- You can use the `find_tags()` tool to see what user-defined tags are available.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug,
      regionUrl: ParamRegionUrl.optional(),
      projectSlug: ParamProjectSlugOrAll.optional(),
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
      "Be careful when using this tool!",
      "",
      "Use this tool when you need to:",
      "- Create a new team in a Sentry organization",
      "",
      "<hints>",
      "- If any parameter is ambiguous, you should clarify with the user what they meant.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug,
      regionUrl: ParamRegionUrl.optional(),
      name: z.string().trim().describe("The name of the team to create."),
    },
  },
  {
    name: "create_project" as const,
    description: [
      "Create a new project in Sentry, giving you access to a new SENTRY_DSN.",
      "",
      "Be careful when using this tool!",
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
      organizationSlug: ParamOrganizationSlug,
      regionUrl: ParamRegionUrl.optional(),
      teamSlug: ParamTeamSlug,
      name: z
        .string()
        .trim()
        .describe(
          "The name of the project to create. Typically this is commonly the name of the repository or service. It is only used as a visual label in Sentry.",
        ),
      platform: ParamPlatform.optional(),
    },
  },
  {
    name: "create_dsn" as const,
    description: [
      "Create a new Sentry DSN for a specific project.",
      "",
      "Be careful when using this tool!",
      "",
      "Use this tool when you need to:",
      "- Create a new DSN for a specific project",
      "",
      "<examples>",
      "### Create a new DSN for the 'my-project' project",
      "",
      "```",
      "create_dsn(organizationSlug='my-organization', projectSlug='my-project', name='Production')",
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
      organizationSlug: ParamOrganizationSlug,
      regionUrl: ParamRegionUrl.optional(),
      projectSlug: ParamProjectSlug,
      name: z
        .string()
        .trim()
        .describe("The name of the DSN to create, for example 'Production'."),
    },
  },
  {
    name: "update_project" as const,
    description: [
      "Update project settings in Sentry, such as name, slug, platform, and team assignment.",
      "",
      "Be careful when using this tool!",
      "",
      "Use this tool when you need to:",
      "- Update a project's name or slug to fix onboarding mistakes",
      "- Change the platform assigned to a project",
      "- Update team assignment for a project",
      "",
      "<examples>",
      "### Update a project's name and slug",
      "",
      "```",
      "update_project(organizationSlug='my-organization', projectSlug='old-project', name='New Project Name', slug='new-project-slug')",
      "```",
      "",
      "### Assign a project to a different team",
      "",
      "```",
      "update_project(organizationSlug='my-organization', projectSlug='my-project', teamSlug='backend-team')",
      "```",
      "",
      "### Update platform",
      "",
      "```",
      "update_project(organizationSlug='my-organization', projectSlug='my-project', platform='python')",
      "```",
      "",
      "</examples>",
      "",
      "<hints>",
      "- If the user passes a parameter in the form of name/otherName, it's likely in the format of <organizationSlug>/<projectSlug>.",
      "- Team assignment is handled separately from other project settings",
      "- If any parameter is ambiguous, you should clarify with the user what they meant.",
      "- When updating the slug, the project will be accessible at the new slug after the update",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug,
      regionUrl: ParamRegionUrl.optional(),
      projectSlug: ParamProjectSlug,
      name: z
        .string()
        .trim()
        .describe("The new name for the project")
        .optional(),
      slug: z
        .string()
        .toLowerCase()
        .trim()
        .describe("The new slug for the project (must be unique)")
        .optional(),
      platform: ParamPlatform.optional(),
      teamSlug: ParamTeamSlug.optional().describe(
        "The team to assign this project to. Note: this will replace the current team assignment.",
      ),
    },
  },
  {
    name: "find_dsns" as const,
    description: [
      "List all Sentry DSNs for a specific project.",
      "",
      "Use this tool when you need to:",
      "- Retrieve a SENTRY_DSN for a specific project",
      "",
      "<hints>",
      "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectSlug>.",
      "- If only one parameter is provided, and it could be either `organizationSlug` or `projectSlug`, its probably `organizationSlug`, but if you're really uncertain you might want to call `find_organizations()` first.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug,
      regionUrl: ParamRegionUrl.optional(),
      projectSlug: ParamProjectSlug,
    },
  },
  {
    name: "begin_seer_issue_fix" as const,
    description: [
      "Use Seer to analyze an issue in Sentry, identify a root cause, and suggest a fix for it.",
      "",
      "Use this tool when you need to:",
      "- Determine the root cause of an issue.",
      "- Generate a plan for fixing an issue.",
      "- Implement a fix for an issue.",
      "",
      "This operation may take some time, so you should call `get_seer_issue_fix_status()` to check the status of the analysis after you begin it.",
      "",
      "<examples>",
      "### Analyze and propose a fix for 'ISSUE-123' in Sentry",
      "",
      "```",
      "begin_seer_issue_fix(organizationSlug='my-organization', issueId='ISSUE-123')",
      "```",
      "</examples>",
      "",
      "<hints>",
      "- Always check to see if an issue fix is already in progress for before calling this tool by using `get_seer_issue_fix_status()`.",
      "- If the user provides the issueUrl, you can ignore the organizationSlug and issueId parameters.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      regionUrl: ParamRegionUrl.optional(),
      issueId: ParamIssueShortId.optional(),
      issueUrl: ParamIssueUrl.optional(),
    },
  },
  {
    name: "get_seer_issue_fix_status" as const,
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
      "get_seer_issue_fix_status(organizationSlug='my-organization', issueId='ISSUE-123')",
      "```",
      "",
      "</examples>",
      "",
      "<hints>",
      "- If the user provides the issueUrl, you can ignore the organizationSlug and issueId parameters.",
      "</hints>",
    ].join("\n"),
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      regionUrl: ParamRegionUrl.optional(),
      issueId: ParamIssueShortId.optional(),
      issueUrl: ParamIssueUrl.optional(),
    },
  },
];
