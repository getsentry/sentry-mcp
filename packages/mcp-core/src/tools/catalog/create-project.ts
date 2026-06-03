import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { logIssue } from "../../telem/logging";
import type { ServerContext } from "../../types";
import type { ClientKey } from "../../api-client/index";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamTeamSlug,
  ParamPlatform,
} from "../../schema";

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
    "- 'Create a project for my-repo'",
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
    "### Create project and link to a repository",
    "```",
    "create_project(organizationSlug='my-organization', teamSlug='my-team', name='my-project', platform='javascript', repository='getsentry/sentry')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<teamSlug>.",
    "- If any parameter is ambiguous, you should clarify with the user what they meant.",
    "- The repository parameter accepts a repo name (e.g. 'getsentry/sentry'). The repo must already be connected to the org via a VCS integration.",
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
        "The name of the project to create. Typically this is commonly the name of the repository or service. It is only used as a visual label in Sentry.",
      ),
    platform: ParamPlatform.nullable().default(null),
    repository: z
      .string()
      .trim()
      .nullable()
      .default(null)
      .describe(
        "Optional repository name to link to the project (e.g. 'getsentry/sentry'). The repo must already be connected to the organization via a VCS integration.",
      ),
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
      logIssue(err);
    }

    let repoStatus: "linked" | "not_found" | "link_failed" | null = null;
    let repoName: string | null = null;
    if (params.repository) {
      try {
        const repos = await apiService.listRepos({
          organizationSlug,
          query: params.repository,
        });
        const match = repos.find(
          (r) =>
            r.name === params.repository ||
            r.name.endsWith(`/${params.repository}`),
        );
        if (match) {
          repoName = match.name;
          try {
            await apiService.linkProjectRepo({
              organizationSlug,
              projectSlug: project.slug,
              repositoryId: match.id,
            });
            repoStatus = "linked";
          } catch (err) {
            logIssue(err);
            repoStatus = "link_failed";
          }
        } else {
          repoStatus = "not_found";
        }
      } catch (err) {
        logIssue(err);
        repoStatus = "not_found";
      }
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
    if (repoStatus === "linked" && repoName) {
      output += `**Repository**: ${repoName} (linked)\n\n`;
    } else if (repoStatus === "link_failed" && repoName) {
      output += `**Repository**: Found ${repoName} but failed to link it to the project. Check permissions and try linking manually.\n\n`;
    } else if (repoStatus === "not_found") {
      output += `**Repository**: Could not find repository "${params.repository}" in the organization. Make sure it's connected via a VCS integration.\n\n`;
    }
    output += "## Response Notes\n\n";
    output += `- Please tell the user the project slug and **SENTRY_DSN**.\n`;
    output += `- The **SENTRY_DSN** value is used to initialize Sentry SDKs.\n`;
    return output;
  },
});
