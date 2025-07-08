import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "./utils/defineTool";
import { apiServiceFromContext } from "./utils/api-utils";
import { logError } from "../logging";
import type { ServerContext } from "../types";
import type { ClientKey } from "../api-client/index";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamTeamSlug,
  ParamPlatform,
} from "../schema";

export default defineTool({
  name: "create_project",
  description: [
    "Create a new project in Sentry, giving you access to a new SENTRY_DSN.",
    "",
    "Be careful when using this tool!",
    "",
    "Use this tool when you need to:",
    "- Create a new project in a Sentry organization",
    "",
    "<examples>",
    "### Create a new javascript project in the 'my-organization' organization",
    "",
    "```",
    "create_project(organizationSlug='my-organization', teamSlug='my-team', name='my-project', platform='javascript')",
    "```",
    "",
    "</examples>",
    "",
    "<hints>",
    "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<teamSlug>.",
    "- If any parameter is ambiguous, you should clarify with the user what they meant.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.optional(),
    teamSlug: ParamTeamSlug,
    name: z
      .string()
      .trim()
      .describe(
        "The name of the project to create. Typically this is commonly the name of the repository or service. It is only used as a visual label in Sentry.",
      ),
    platform: ParamPlatform.optional(),
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);
    setTag("team.slug", params.teamSlug);

    const project = await apiService.createProject({
      organizationSlug,
      teamSlug: params.teamSlug,
      name: params.name,
      platform: params.platform,
    });
    let clientKey: ClientKey | null = null;
    try {
      clientKey = await apiService.createClientKey({
        organizationSlug,
        projectSlug: project.slug,
        name: "Default",
      });
    } catch (err) {
      logError(err);
    }
    let output = `# New Project in **${organizationSlug}**\n\n`;
    output += `**ID**: ${project.id}\n`;
    output += `**Slug**: ${project.slug}\n`;
    output += `**Name**: ${project.name}\n`;
    if (clientKey) {
      output += `**SENTRY_DSN**: ${clientKey?.dsn.public}\n\n`;
    } else {
      output += "**SENTRY_DSN**: There was an error fetching this value.\n\n";
    }
    output += "# Using this information\n\n";
    output += `- You can reference the **SENTRY_DSN** value to initialize Sentry's SDKs.\n`;
    output += `- You should always inform the user of the **SENTRY_DSN** and Project Slug values.\n`;
    return output;
  },
});
