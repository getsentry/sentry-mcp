import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamSearchQuery,
} from "../schema";

const RESULT_LIMIT = 25;

export default defineTool({
  name: "find_teams",
  requiredSkills: ["inspect", "triage", "project-management"], // Team viewing and management
  requiredScopes: ["team:read"],
  description: [
    "Find teams in an organization in Sentry.",
    "",
    "Use this tool when you need to:",
    "- View teams in a Sentry organization",
    "- Find a team's slug to aid other tool requests",
    "- Search for specific teams by name or slug",
    "",
    `Returns up to ${RESULT_LIMIT} results. If you hit this limit, use the query parameter to narrow down results.`,
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.optional(),
    query: ParamSearchQuery.optional(),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    if (!organizationSlug) {
      throw new UserInputError(
        "Organization slug is required. Please provide an organizationSlug parameter.",
      );
    }

    setTag("organization.slug", organizationSlug);

    const teams = await apiService.listTeams(organizationSlug, {
      query: params.query,
    });

    let output = `# Teams in **${organizationSlug}**\n\n`;

    if (params.query) {
      output += `**Search query:** "${params.query}"\n\n`;
    }

    if (teams.length === 0) {
      output += params.query
        ? `No teams found matching "${params.query}".\n`
        : "No teams found.\n";
      return output;
    }

    output += teams.map((team) => `- ${team.slug}\n`).join("");

    if (teams.length === RESULT_LIMIT) {
      output += `\n---\n\n**Note:** Showing ${RESULT_LIMIT} results (maximum). There may be more teams available. Use the \`query\` parameter to search for specific teams.`;
    }

    return output;
  },
});
