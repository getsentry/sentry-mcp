import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import type { ServerContext } from "../../types";
import {
  ParamOrganizationSlug,
  ParamProjectSlug,
  ParamRegionUrl,
  ParamTeamSlug,
  ParamPlatform,
} from "../../schema";
import type { ClientKey } from "../../api-client/index";

function getUsableClientKey(clientKeys: ClientKey[]): ClientKey | undefined {
  return (
    clientKeys.find(
      (key) => key.name === "Default" && key.isActive && key.dsn.public,
    ) ??
    clientKeys.find((key) => key.isActive && key.dsn.public) ??
    clientKeys.find((key) => key.name === "Default" && key.dsn.public) ??
    clientKeys.find((key) => key.dsn.public)
  );
}

export default defineTool({
  name: "create_project",
  skills: ["project-management"], // Only available in project-management skill
  requiredScopes: ["project:write", "team:read", "org:read"],
  description: [
    "Create a new project in Sentry (includes DSN automatically).",
    "",
    "USE THIS TOOL WHEN USERS WANT TO:",
    "- 'Create a new project'",
    "- 'Set up a project for [app/service] with team [X]'",
    "- 'I need a new Sentry project'",
    "- Create project AND need DSN in one step",
    "",
    "DO NOT USE create_dsn after this - DSN is included in output.",
    "",
    "Be careful when using this tool!",
    "",
    "<examples>",
    "### Create new project with team",
    "```",
    "create_project(organizationSlug='my-organization', teamSlug='my-team', name='my-project', platform='javascript')",
    "```",
    "### Create project with an explicit slug",
    "```",
    "create_project(organizationSlug='my-organization', teamSlug='my-team', name='My Project', slug='my-project', platform='javascript')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<teamSlug>.",
    "- If any parameter is ambiguous, you should clarify with the user what they meant.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    teamSlug: ParamTeamSlug,
    name: z
      .string()
      .trim()
      .describe(
        "The name of the project to create. Typically this is the name of the application or service. It is only used as a visual label in Sentry.",
      ),
    slug: ParamProjectSlug.describe("Optional project slug to create.")
      .nullable()
      .default(null),
    platform: ParamPlatform.nullable().default(null),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);
    setTag("team.slug", params.teamSlug);

    const project = await apiService.createProject({
      organizationSlug,
      teamSlug: params.teamSlug,
      name: params.name,
      slug: params.slug,
      platform: params.platform,
    });

    const clientKeys = await apiService.listClientKeys({
      organizationSlug,
      projectSlug: project.slug,
    });
    let clientKey = getUsableClientKey(clientKeys);

    if (!clientKey) {
      clientKey = await apiService.createClientKey({
        organizationSlug,
        projectSlug: project.slug,
        name: "Default",
      });
    }

    let output = `# New Project in **${organizationSlug}**\n\n`;
    output += `**ID**: ${project.id}\n`;
    output += `**Slug**: ${project.slug}\n`;
    output += `**Name**: ${project.name}\n`;
    output += `**SENTRY_DSN**: ${clientKey.dsn.public}\n\n`;
    output += "## Response Notes\n\n";
    output += `- Please tell the user the project slug and **SENTRY_DSN**.\n`;
    output += `- The **SENTRY_DSN** value is used to initialize Sentry SDKs.\n`;
    return output;
  },
});
