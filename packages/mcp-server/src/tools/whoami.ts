import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import type { ServerContext } from "../types";
import { ALL_SKILLS } from "../skills";

export default defineTool({
  name: "whoami",
  description: [
    "Identify the authenticated user in Sentry.",
    "",
    "Use this tool when you need to:",
    "- Get the user's name and email address.",
  ].join("\n"),
  inputSchema: {},
  requiredSkills: ALL_SKILLS, // Foundational tool - available to all skills
  requiredScopes: [], // No specific scopes required - uses authentication token
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    // User data endpoints (like /auth/) should never use regionUrl
    // as they must always query the main API server, not region-specific servers
    const apiService = apiServiceFromContext(context);
    // API client will throw ApiClientError/ApiServerError which the MCP server wrapper handles
    const user = await apiService.getAuthenticatedUser();

    let output = `You are authenticated as ${user.name} (${user.email}).\n\nYour Sentry User ID is ${user.id}.`;

    // Add constraints information
    const constraints = context.constraints;
    if (
      constraints.organizationSlug ||
      constraints.projectSlug ||
      constraints.regionUrl
    ) {
      output += "\n\n## Session Constraints\n\n";

      if (constraints.organizationSlug) {
        output += `- **Organization**: ${constraints.organizationSlug}\n`;
      }
      if (constraints.projectSlug) {
        output += `- **Project**: ${constraints.projectSlug}\n`;
      }
      if (constraints.regionUrl) {
        output += `- **Region URL**: ${constraints.regionUrl}\n`;
      }

      output += "\nThese constraints limit the scope of this MCP session.";
    }

    return output;
  },
});
