import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env, Props } from "./types";
import { z } from "zod";
import type { SentryEventSchema } from "./schema";
import { SentryApiService } from "./sentry-api";

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
      "get_error_details",
      "Retrieve error details from Sentry for a specific Issue ID, including the stacktrace and error message.",
      {
        issue_id: z.string().describe("The Issue ID to retrieve details for"),
      },
      async ({ issue_id }) => {
        try {
          const apiService = new SentryApiService(
            this.props.accessToken as string,
            this.props.organizationSlug as string
          );
          const event = await apiService.getLatestEvent(issue_id);

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
          console.error("Error fetching error details:", error);
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
      "Search for errors recently occurring in a specific file.",
      {
        filename: z
          .string()
          .describe("The path or name of the file to search for errors in"),
        sortBy: z
          .enum(["last_seen", "count"])
          .optional()
          .default("last_seen")
          .describe(
            "Sort the results either by the last time they occurred or the count of occurrences."
          ),
      },
      async ({ filename, sortBy }) => {
        try {
          const apiService = new SentryApiService(
            this.props.accessToken as string,
            this.props.organizationSlug as string
          );

          const eventList = await apiService.searchErrorsInFile(
            filename,
            sortBy
          );

          if (eventList.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `# No errors found\nCould not find any errors affecting file \`${filename}\`.`,
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
          console.error("Error searching for file:", error);
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
  }
}
