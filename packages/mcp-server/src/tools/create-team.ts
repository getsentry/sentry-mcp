import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "./utils/defineTool";
import { apiServiceFromContext } from "./utils/api-utils";
import type { ServerContext } from "../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../schema";

export default defineTool({
  name: "create_team",
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
    let mdOutput = `# New Team in **${organizationSlug}**\n\n`;
    mdOutput += `**ID**: ${team.id}\n`;
    mdOutput += `**Slug**: ${team.slug}\n`;
    mdOutput += `**Name**: ${team.name}\n`;
    mdOutput += "# Using this information\n\n";
    mdOutput += `- You should always inform the user of the Team Slug value.\n`;

    if (params.responseType === "json") {
      return {
        organizationSlug,
        team,
      };
    }

    return mdOutput;
  },
});
