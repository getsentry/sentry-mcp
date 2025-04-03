import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Props } from "../types";
import { z } from "zod";
import {
  ParamIssueShortId,
  ParamOrganizationSlug,
  ParamPlatform,
  ParamTeamSlug,
  type SentryEventSchema,
} from "../schema";
import { SentryApiService } from "./sentry-api";
import { logError } from "./log";

function formatEventOutput(event: z.infer<typeof SentryEventSchema>) {
  let output = "";
  for (const entry of event.entries) {
    if (entry.type === "exception") {
      const firstError = entry.data.value ?? entry.data.values[0];
      if (!firstError) {
        continue;
      }
      output += `**Error:**\n${"```"}\n${firstError.type}: ${
        firstError.value
      }\n${"```"}\n\n`;
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

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
export default class SentryMCP extends McpAgent<Props, Env> {
  server = new McpServer({
    name: "Sentry MCP",
    version: "0.1.0",
  });

  async init() {
    this.server.tool(
      "list_organizations",
      "List all organizations that the user has access to in Sentry.",
      {},
      async () => {
        try {
          const apiService = new SentryApiService(
            this.props.accessToken as string
          );
          const organizations = await apiService.listOrganizations();

          let output = "# Organizations\n\n";
          output += organizations.map((org) => `- ${org.slug}\n`).join("");

          return {
            content: [
              {
                type: "text",
                text: output,
              },
            ],
          };
        } catch (error) {
          logError(error);
          return {
            content: [
              {
                type: "text",
                text: `Failed to fetch error details: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.tool(
      "get_error_details",
      "Retrieve error details from Sentry for a specific Issue ID, including the stacktrace and error message.",
      {
        organization_slug: ParamOrganizationSlug.optional(),
        issue_id: ParamIssueShortId,
      },
      async ({ issue_id, organization_slug }) => {
        try {
          const apiService = new SentryApiService(
            this.props.accessToken as string
          );
          const event = await apiService.getLatestEventForIssue(
            organization_slug ?? (this.props.organizationSlug as string),
            issue_id
          );

          let output = `# ${issue_id}: ${event.title}\n\n`;
          output += `**Issue ID**:\n${issue_id}\n\n`;

          output += formatEventOutput(event);

          output += "# Using this information\n\n";
          output += `- You can reference the IssueID in commit messages (e.g. \`Fixes ${issue_id}\`) to automatically close the issue when the commit is merged.\n`;
          output +=
            "- The stacktrace includes both first-party application code as well as third-party code, its important to triage to first-party code.\n";

          return {
            content: [
              {
                type: "text",
                text: output,
              },
            ],
          };
        } catch (error) {
          logError(error);
          return {
            content: [
              {
                type: "text",
                text: `Failed to fetch error details: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.tool(
      "search_errors_in_file",
      "Search for errors recently occurring in a specific file. This is a suffix based search, so only using the filename or the direct parent folder of the file. The parent folder is preferred when the filename is in a subfolder or a common filename.",
      {
        organization_slug: ParamOrganizationSlug.optional(),
        filename: z.string().describe("The filename to search for errors in."),
        sortBy: z
          .enum(["last_seen", "count"])
          .optional()
          .default("last_seen")
          .describe(
            "Sort the results either by the last time they occurred or the count of occurrences."
          ),
      },
      async ({ filename, sortBy, organization_slug }) => {
        try {
          const apiService = new SentryApiService(
            this.props.accessToken as string
          );

          const eventList = await apiService.searchErrorsInFile(
            organization_slug ?? (this.props.organizationSlug as string),
            filename,
            sortBy
          );

          if (eventList.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `# No errors found\n\nCould not find any errors affecting file \`${filename}\`.\n\nWe searched within the ${this.props.organizationSlug} organization.`,
                },
              ],
            };
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

          return {
            content: [
              {
                type: "text",
                text: output,
              },
            ],
          };
        } catch (error) {
          logError(error);
          return {
            content: [
              {
                type: "text",
                text: `Error searching for file:\n${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.tool(
      "list_teams",
      "Retrieve a list of teams in Sentry.",
      {
        organization_slug: ParamOrganizationSlug,
      },
      async ({ organization_slug }) => {
        const apiService = new SentryApiService(
          this.props.accessToken as string
        );

        try {
          const teams = await apiService.listTeams(organization_slug);

          let output = `# Teams in **${organization_slug}**\n\n`;
          output += teams.map((team) => `- ${team.slug}\n`).join("");

          return {
            content: [
              {
                type: "text",
                text: output,
              },
            ],
          };
        } catch (error) {
          logError(error);
          return {
            content: [
              {
                type: "text",
                text: `Failed to fetch error details: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.tool(
      "create_project",
      "Create a new project in Sentry, giving you access to a new SENTRY_DSN.",
      {
        organization_slug: ParamOrganizationSlug.optional(),
        team_slug: ParamTeamSlug,
        name: z
          .string()
          .describe(
            "The name of the project to create. Typically this is commonly the name of the repository or service. It is only used as a visual label in Sentry."
          ),
        platform: ParamPlatform.optional(),
      },
      async ({ organization_slug, team_slug, name, platform }) => {
        const apiService = new SentryApiService(
          this.props.accessToken as string
        );

        try {
          const [project, clientKey] = await apiService.createProject(
            organization_slug ?? (this.props.organizationSlug as string),
            team_slug,
            name,
            platform
          );

          let output = "# New Project";
          output += `- **ID**: ${project.id}\n`;
          output += `- **Slug**: ${project.slug}\n`;
          output += `- **Name**: ${project.name}\n`;

          if (clientKey) {
            output += `**SENTRY_DSN**: ${clientKey?.dsn.public}\n\n`;
          } else {
            output +=
              "**SENTRY_DSN**: There was an error fetching this value.\n\n";
          }

          output += "# Using this information\n\n";
          output += `- You can reference the **SENTRY_DSN** value to initialize Sentry's SDKs.\n`;

          return {
            content: [
              {
                type: "text",
                text: output,
              },
            ],
          };
        } catch (error) {
          logError(error);
          return {
            content: [
              {
                type: "text",
                text: `Failed to fetch error details: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }
}
