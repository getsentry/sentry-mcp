import { z } from "zod";
import { defineTool } from "../internal/tool-helpers/define";
import {
  apiServiceFromContext,
  withApiErrorHandling,
} from "../internal/tool-helpers/api";
import type { ServerContext } from "../types";

export default defineTool({
  name: "find_organizations",
  description: [
    "Find organizations that the user has access to in Sentry.",
    "",
    "Use this tool when you need to:",
    "- View all organizations in Sentry",
    "- Find an organization's slug to aid other tool requests",
    "- Get the regionUrl for an organization (required for many API calls)",
    "",
    "Note: Even when the session is constrained to a specific organization,",
    "you should still call this tool if you need the regionUrl for API calls.",
  ].join("\n"),
  inputSchema: {},
  async handler(params, context: ServerContext) {
    // User data endpoints (like /users/me/regions/) should never use regionUrl
    // as they must always query the main API server, not region-specific servers
    const apiService = apiServiceFromContext(context);
    let organizations = await withApiErrorHandling(
      () => apiService.listOrganizations(),
      {}, // No params for this endpoint
    );

    // Filter organizations based on constraints
    // TODO: This fetches ALL organizations then filters client-side, which is inefficient
    // for users with many organizations. Unlike projects, there's no getOrganization
    // endpoint to fetch a single org directly. This could be optimized by:
    // 1. Adding a getOrganization endpoint to the API
    // 2. Adding a filter parameter to the list endpoint
    // 3. Caching organization data in the context when constraints are set
    if (context.constraints.organizationSlug) {
      organizations = organizations.filter(
        (org) => org.slug === context.constraints.organizationSlug,
      );
    }

    let output = "# Organizations\n\n";

    // Add note if constrained
    if (context.constraints.organizationSlug) {
      output += `*Note: This MCP session is constrained to organization **${context.constraints.organizationSlug}**. Organization parameters will be automatically provided to tools.*\n`;
      output += `*However, you still need to use this tool to get the regionUrl for API calls.*\n\n`;
    }

    if (organizations.length === 0) {
      if (context.constraints.organizationSlug) {
        output += `The constrained organization **${context.constraints.organizationSlug}** was not found or you don't have access to it.\n`;
      } else {
        output += "You don't appear to be a member of any organizations.\n";
      }
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
