import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import type { ServerContext } from "../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamProjectSlug,
} from "../schema";

export default defineTool({
  name: "find_dsns",
  requiredSkills: ["project-management"], // DSN management is part of project setup
  requiredScopes: ["project:read"],
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
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.optional(),
    projectSlug: ParamProjectSlug,
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

    setTag("organization.slug", organizationSlug);
    setTag("project.slug", params.projectSlug);

    const clientKeys = await apiService.listClientKeys({
      organizationSlug,
      projectSlug: params.projectSlug,
    });
    let output = `# DSNs in **${organizationSlug}/${params.projectSlug}**\n\n`;
    if (clientKeys.length === 0) {
      output +=
        "No DSNs were found.\n\nYou can create new one using the `create_dsn` tool.";
      return output;
    }
    for (const clientKey of clientKeys) {
      output += `## ${clientKey.name}\n`;
      output += `**ID**: ${clientKey.id}\n`;
      output += `**DSN**: ${clientKey.dsn.public}\n\n`;
    }
    output += "# Using this information\n\n";
    output +=
      "- The `SENTRY_DSN` value is a URL that you can use to initialize Sentry's SDKs.\n";
    return output;
  },
});
