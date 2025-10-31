import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import type { ServerContext } from "../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../schema";

export default defineTool({
  name: "create_team",
  requiredSkills: ["project-management"], // Only available in project-management skill
  requiredScopes: ["team:write"],
  description: [
    "Create a new team in Sentry.",
    "",
    "🔍 USE THIS TOOL WHEN USERS WANT TO:",
    "- 'Create a new team'",
    "- 'Set up a team called [X]'",
    "- 'I need a team for my project'",
    "",
    "Be careful when using this tool!",
    "",
    "<examples>",
    "### Create a new team",
    "```",
    "create_team(organizationSlug='my-organization', name='the-goats')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- If any parameter is ambiguous, you should clarify with the user what they meant.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.optional(),
    name: z.string().trim().describe("The name of the team to create."),
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

    const team = await apiService.createTeam({
      organizationSlug,
      name: params.name,
    });
    let output = `# New Team in **${organizationSlug}**\n\n`;
    output += `**ID**: ${team.id}\n`;
    output += `**Slug**: ${team.slug}\n`;
    output += `**Name**: ${team.name}\n`;
    output += "# Using this information\n\n";
    output += `- You should always inform the user of the Team Slug value.\n`;
    return output;
  },
});
