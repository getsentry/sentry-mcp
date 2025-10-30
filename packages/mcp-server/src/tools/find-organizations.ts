import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import type { ServerContext } from "../types";
import { ParamSearchQuery } from "../schema";
import { ALL_SKILLS } from "../skills";

const RESULT_LIMIT = 25;

export default defineTool({
  name: "find_organizations",
  requiredSkills: ALL_SKILLS, // Foundational tool - available to all skills
  requiredScopes: ["org:read"],
  description: [
    "Find organizations that the user has access to in Sentry.",
    "",
    "Use this tool when you need to:",
    "- View organizations in Sentry",
    "- Find an organization's slug to aid other tool requests",
    "- Search for specific organizations by name or slug",
    "",
    `Returns up to ${RESULT_LIMIT} results. If you hit this limit, use the query parameter to narrow down results.`,
  ].join("\n"),
  inputSchema: {
    query: ParamSearchQuery.optional(),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    // User data endpoints (like /users/me/regions/) should never use regionUrl
    // as they must always query the main API server, not region-specific servers
    const apiService = apiServiceFromContext(context);
    const organizations = await apiService.listOrganizations({
      query: params.query,
    });

    let output = "# Organizations\n\n";

    if (params.query) {
      output += `**Search query:** "${params.query}"\n\n`;
    }

    if (organizations.length === 0) {
      output += params.query
        ? `No organizations found matching "${params.query}".\n`
        : "You don't appear to be a member of any organizations.\n";
      return output;
    }

    output += organizations
      .map((org) =>
        [
          `## **${org.slug}**`,
          "",
          `**Web URL:** ${org.links?.organizationUrl || "Not available"}`,
          `**Region URL:** ${org.links?.regionUrl || ""}`,
        ].join("\n"),
      )
      .join("\n\n");

    if (organizations.length === RESULT_LIMIT) {
      output += `\n\n---\n\n**Note:** Showing ${RESULT_LIMIT} results (maximum). There may be more organizations available. Use the \`query\` parameter to search for specific organizations.`;
    }

    output += "\n\n# Using this information\n\n";
    output += `- The organization's name is the identifier for the organization, and is used in many tools for \`organizationSlug\`.\n`;

    const hasValidRegionUrls = organizations.some((org) =>
      org.links?.regionUrl?.trim(),
    );

    if (hasValidRegionUrls) {
      output += `- If a tool supports passing in the \`regionUrl\`, you MUST pass in the correct value shown above for each organization.\n`;
      output += `- For Sentry's Cloud Service (sentry.io), always use the regionUrl to ensure requests go to the correct region.\n`;
    } else {
      output += `- This appears to be a self-hosted Sentry installation. You can omit the \`regionUrl\` parameter when using other tools.\n`;
      output += `- For self-hosted Sentry, the regionUrl is typically empty and not needed for API calls.\n`;
    }

    return output;
  },
});
