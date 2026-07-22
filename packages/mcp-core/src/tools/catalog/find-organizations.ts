import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import type { ServerContext } from "../../types";
import { ParamSearchQuery } from "../../schema";
import { ALL_SKILLS } from "../../skills";

const RESULT_LIMIT = 25;

export default defineTool({
  name: "find_organizations",
  skills: ALL_SKILLS, // Foundational tool - available to all skills
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
    query: ParamSearchQuery.nullable().default(null),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    // Organizations are listed from the root host, which returns orgs across
    // all regions, so no regionUrl is passed here.
    const apiService = apiServiceFromContext(context);
    const organizations = await apiService.listOrganizations({
      query: params.query ?? undefined,
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

    output += "\n\n## Response Notes\n\n";
    output += `- The organization slug is used as \`organizationSlug\` in other tools.\n`;

    const hasValidRegionUrls = organizations.some((org) =>
      org.links?.regionUrl?.trim(),
    );

    if (hasValidRegionUrls) {
      output += `- The Region URL shown above is the \`regionUrl\` value for later tools that accept it. This keeps Sentry Cloud requests on the correct region.\n`;
    } else {
      output += `- This appears to be a self-hosted Sentry installation. The \`regionUrl\` parameter can be omitted in other tools.\n`;
    }

    return output;
  },
});
