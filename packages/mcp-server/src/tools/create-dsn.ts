import { z } from "zod";
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
  name: "create_dsn",
  requiredSkills: ["project-management"], // Only available in project-management skill
  requiredScopes: ["project:write"],
  description: [
    "Create an additional DSN for an EXISTING project.",
    "",
    "🔍 USE THIS TOOL WHEN:",
    "- Project already exists and needs additional DSN",
    "- 'Create another DSN for project X'",
    "- 'I need a production DSN for existing project'",
    "",
    "❌ DO NOT USE for new projects (use create_project instead)",
    "",
    "Be careful when using this tool!",
    "",
    "<examples>",
    "### Create additional DSN for existing project",
    "```",
    "create_dsn(organizationSlug='my-organization', projectSlug='my-project', name='Production')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectSlug>.",
    "- If any parameter is ambiguous, you should clarify with the user what they meant.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.optional(),
    projectSlug: ParamProjectSlug,
    name: z
      .string()
      .trim()
      .describe("The name of the DSN to create, for example 'Production'."),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);
    setTag("project.slug", params.projectSlug);

    const clientKey = await apiService.createClientKey({
      organizationSlug,
      projectSlug: params.projectSlug,
      name: params.name,
    });
    let output = `# New DSN in **${organizationSlug}/${params.projectSlug}**\n\n`;
    output += `**DSN**: ${clientKey.dsn.public}\n`;
    output += `**Name**: ${clientKey.name}\n\n`;
    output += "# Using this information\n\n";
    output +=
      "- The `SENTRY_DSN` value is a URL that you can use to initialize Sentry's SDKs.\n";
    return output;
  },
});
