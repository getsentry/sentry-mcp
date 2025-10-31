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
import { ALL_SKILLS } from "../skills";

const RESULT_LIMIT = 25;

export default defineTool({
  name: "find_projects",
  requiredSkills: ALL_SKILLS, // Foundational tool - available to all skills
  requiredScopes: ["project:read"],
  description: [
    "Find projects in Sentry.",
    "",
    "Use this tool when you need to:",
    "- View projects in a Sentry organization",
    "- Find a project's slug to aid other tool requests",
    "- Search for specific projects by name or slug",
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

    const projects = await apiService.listProjects(organizationSlug, {
      query: params.query,
    });

    let output = `# Projects in **${organizationSlug}**\n\n`;

    if (params.query) {
      output += `**Search query:** "${params.query}"\n\n`;
    }

    if (projects.length === 0) {
      output += params.query
        ? `No projects found matching "${params.query}".\n`
        : "No projects found.\n";
      return output;
    }

    output += projects.map((project) => `- **${project.slug}**\n`).join("");

    if (projects.length === RESULT_LIMIT) {
      output += `\n---\n\n**Note:** Showing ${RESULT_LIMIT} results (maximum). There may be more projects available. Use the \`query\` parameter to search for specific projects.`;
    }

    return output;
  },
});
