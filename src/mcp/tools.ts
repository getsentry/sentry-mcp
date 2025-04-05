import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Props } from "../types";
import { z } from "zod";
import type { SentryErrorEntrySchema, SentryEventSchema } from "../lib/sentry-api";
import { SentryApiService } from "../lib/sentry-api";
import { ParamIssueShortId, ParamOrganizationSlug, ParamPlatform, ParamTeamSlug } from "./schema";

function formatEventOutput(event: z.infer<typeof SentryEventSchema>) {
  let output = "";
  for (const entry of event.entries) {
    if (entry.type === "exception") {
      const data = entry.data as z.infer<typeof SentryErrorEntrySchema>;
      const firstError = data.value ?? data.values[0];
      if (!firstError) {
        continue;
      }
      output += `**Error:**\n${"```"}\n${firstError.type}: ${firstError.value}\n${"```"}\n\n`;
      if (!firstError.stacktrace || !firstError.stacktrace.frames) {
        continue;
      }
      output += `**Stacktrace:**\n${"```"}\n${firstError.stacktrace.frames
        .map((frame) => {
          const context = frame.context?.length
            ? `:${frame.context
                .filter(([lineno, _]) => lineno === frame.lineNo)
                .map(([_, code]) => `\n${code}`)
                .join("")}`
            : "";

          return `in "${frame.filename || frame.module}"${
            frame.lineNo ? ` at line ${frame.lineNo}` : ""
          }${context}`;
        })
        .join("\n")}\n${"```"}\n\n`;
    }
  }
  return output;
}

export const TOOL_DEFINITIONS = [
  {
    name: "list_organizations" as const,
    description: "List all organizations that the user has access to in Sentry.",
    paramsSchema: {},
  },
  {
    name: "list_teams" as const,
    description: "List all teams in an organization.",
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug,
    },
  },
  {
    name: "list_projects" as const,
    description: "Retrieve a list of projects in Sentry.",
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug,
    },
  },
  {
    name: "get_error_details" as const,
    description:
      "Retrieve error details from Sentry for a specific Issue ID, including the stacktrace and error message.",
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      issueId: ParamIssueShortId,
    },
  },
  {
    name: "search_errors_in_file" as const,
    description:
      "Search for errors recently occurring in a specific file. This is a suffix based search, so only using the filename or the direct parent folder of the file. The parent folder is preferred when the filename is in a subfolder or a common filename.",
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug.optional(),
      filename: z.string().describe("The filename to search for errors in."),
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
    description: "Create a new team in Sentry.",
    paramsSchema: {
      organizationSlug: ParamOrganizationSlug,
      name: z.string().describe("The name of the team to create."),
    },
  },
  {
    name: "create_project" as const,
    description: "Create a new project in Sentry, giving you access to a new SENTRY_DSN.",
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
];

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export type ToolParams<T extends ToolName> = Extract<
  (typeof TOOL_DEFINITIONS)[number],
  { name: T }
>["paramsSchema"];

export type ToolHandler<T extends ToolName> = ToolCallback<ToolParams<T>>;

export type ToolHandlerExtended<T extends ToolName> = (
  ...args: [
    props: Props,
    args: Parameters<ToolHandler<T>>["0"],
    extra: Parameters<ToolHandler<T>>["1"],
  ]
) => Promise<string>;

export type ToolHandlers = {
  [K in ToolName]: ToolHandlerExtended<K>;
};

export const TOOL_HANDLERS = {
  list_organizations: async (props) => {
    const apiService = new SentryApiService(props.accessToken);
    const organizations = await apiService.listOrganizations();

    let output = "# Organizations\n\n";
    output += organizations.map((org) => `- ${org.slug}\n`).join("");

    return output;
  },
  list_teams: async (props, { organizationSlug }) => {
    const apiService = new SentryApiService(props.accessToken);

    if (!organizationSlug) {
      organizationSlug = props.organizationSlug;
    }

    const teams = await apiService.listTeams(organizationSlug);

    let output = `# Teams in **${organizationSlug}**\n\n`;
    output += teams.map((team) => `- ${team.slug}\n`).join("");

    return output;
  },
  list_projects: async (props, { organizationSlug }) => {
    const apiService = new SentryApiService(props.accessToken);

    if (!organizationSlug) {
      organizationSlug = props.organizationSlug;
    }

    const projects = await apiService.listProjects(organizationSlug);

    let output = `# Projects in **${organizationSlug}**\n\n`;
    output += projects.map((project) => `- ${project.slug}\n`).join("");

    return output;
  },
  get_error_details: async (props, { issueId, organizationSlug }) => {
    const apiService = new SentryApiService(props.accessToken);

    if (!organizationSlug) {
      organizationSlug = props.organizationSlug;
    }

    const event = await apiService.getLatestEventForIssue({
      organizationSlug,
      issueId,
    });

    let output = `# ${issueId}: ${event.title}\n\n`;
    output += `**Issue ID**:\n${issueId}\n\n`;

    output += formatEventOutput(event);

    output += "# Using this information\n\n";
    output += `- You can reference the IssueID in commit messages (e.g. \`Fixes ${issueId}\`) to automatically close the issue when the commit is merged.\n`;
    output +=
      "- The stacktrace includes both first-party application code as well as third-party code, its important to triage to first-party code.\n";

    return output;
  },

  search_errors_in_file: async (props, { filename, sortBy, organizationSlug }) => {
    const apiService = new SentryApiService(props.accessToken);

    if (!organizationSlug) {
      organizationSlug = props.organizationSlug;
    }

    const eventList = await apiService.searchErrors({
      organizationSlug,
      filename,
      sortBy,
    });

    if (eventList.length === 0) {
      return `# No errors found\n\nCould not find any errors affecting file \`${filename}\`.\n\nWe searched within the ${organizationSlug} organization.`;
    }

    let output = `# Errors related to \`${filename}\`\n\n`;

    for (const eventSummary of eventList) {
      output += `## ${eventSummary.issue}: ${eventSummary.title}\n\n`;
      output += `- **Issue ID**: ${eventSummary.issue}\n`;
      output += `- **Project**: ${eventSummary.project}\n`;
      output += `- **Last Seen**: ${eventSummary["last_seen()"]}\n`;
      output += `- **Occurrences**: ${eventSummary["count()"]}\n\n`;
    }

    output += "# Using this information\n\n";
    output += `- You can reference the Issue ID in commit messages (e.g. \`Fixes ${eventList[0].issue}\`) to automatically close the issue when the commit is merged.\n`;
    output += `- You can get more details about this error by using the "get_error_details" tool.\n`;

    return output;
  },

  create_team: async (props, { organizationSlug, name }) => {
    const apiService = new SentryApiService(props.accessToken);

    if (!organizationSlug) {
      organizationSlug = props.organizationSlug;
    }

    const team = await apiService.createTeam({
      organizationSlug,
      name,
    });

    let output = "# New Team";
    output += `- **ID**: ${team.id}\n`;
    output += `- **Slug**: ${team.slug}\n`;
    output += `- **Name**: ${team.name}\n`;

    return output;
  },

  create_project: async (props, { organizationSlug, teamSlug, name, platform }) => {
    const apiService = new SentryApiService(props.accessToken);

    if (!organizationSlug) {
      organizationSlug = props.organizationSlug;
    }

    const [project, clientKey] = await apiService.createProject({
      organizationSlug,
      teamSlug,
      name,
      platform,
    });

    let output = "# New Project";
    output += `- **ID**: ${project.id}\n`;
    output += `- **Slug**: ${project.slug}\n`;
    output += `- **Name**: ${project.name}\n`;

    if (clientKey) {
      output += `- **SENTRY_DSN**: ${clientKey?.dsn.public}\n\n`;
    } else {
      output += "- **SENTRY_DSN**: There was an error fetching this value.\n\n";
    }

    output += "# Using this information\n\n";
    output += `- You can reference the **SENTRY_DSN** value to initialize Sentry's SDKs.\n`;

    return output;
  },
} satisfies ToolHandlers;
