import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../schema";

export default defineTool({
  name: "find_teams",
  requiredScopes: ["team:read"],
  description: [
    "Find teams in an organization in Sentry.",
    "",
    "Use this tool when you need to:",
    "- View all teams in a Sentry organization",
    "- Find a team's slug to aid other tool requests",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.optional(),
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

    const teams = await apiService.listTeams(organizationSlug);
    let output = `# Teams in **${organizationSlug}**\n\n`;
    if (teams.length === 0) {
      output += "No teams found.\n";
      return output;
    }
    output += teams.map((team) => `- ${team.slug}\n`).join("");
    return output;
  },
});
