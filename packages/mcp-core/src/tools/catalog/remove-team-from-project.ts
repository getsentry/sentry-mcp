import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { UserInputError } from "../../errors";
import type { Team } from "../../api-client/index";
import type { ServerContext } from "../../types";
import {
  ParamOrganizationSlug,
  ParamProjectSlug,
  ParamRegionUrl,
  ParamTeamSlug,
} from "../../schema";
import { setOrganizationSlug } from "../../internal/tool-helpers/telemetry";

function formatProjectTeams(teams: Team[]): string {
  if (teams.length === 0) {
    return "No teams are currently assigned to this project.\n";
  }

  return teams
    .map((team) => `- **${team.slug}** (ID: ${team.id}) - ${team.name}`)
    .join("\n");
}

function formatTeamSlugs(teams: Team[]): string {
  if (teams.length === 0) {
    return "none";
  }

  return teams.map((team) => `\`${team.slug}\``).join(", ");
}

function formatResponse({
  organizationSlug,
  projectSlug,
  teamSlug,
  teams,
}: {
  organizationSlug: string;
  projectSlug: string;
  teamSlug: string;
  teams: Team[];
}): string {
  let output = `# Team Access Revoked in **${organizationSlug}**\n\n`;
  output += `**Project**: ${projectSlug}\n`;
  output += `**Removed Team**: ${teamSlug}\n`;
  output += "**Result**: Team access was revoked.\n\n";
  output += "## Current Project Teams\n\n";
  output += formatProjectTeams(teams);
  output += "\n\n## Response Notes\n\n";
  output += `- Project slug for later requests: \`${projectSlug}\`\n`;
  output += `- Current team slugs: ${formatTeamSlugs(teams)}\n`;
  return output;
}

export default defineTool({
  name: "remove_team_from_project",
  skills: ["project-management"],
  requiredScopes: ["project:write", "team:read", "org:read"],
  description: [
    "Revoke a team's access to an existing Sentry project.",
    "",
    "Use this tool when you need to:",
    "- Remove a team from a project",
    "- Revoke team access without changing project metadata",
    "- Check project team assignments before removing access",
    "",
    "Be careful when using this tool because it revokes project access.",
    "",
    "<examples>",
    "remove_team_from_project(organizationSlug='my-organization', projectSlug='my-project', teamSlug='my-team')",
    "</examples>",
    "",
    "<hints>",
    "- The team must already be assigned to the project.",
    "- This tool will not remove the last team assigned to a project.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    projectSlug: ParamProjectSlug,
    teamSlug: ParamTeamSlug,
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });
    const organizationSlug = params.organizationSlug;

    setOrganizationSlug(organizationSlug);
    setTag("project.slug", params.projectSlug);
    setTag("team.slug", params.teamSlug);

    const currentTeams = await apiService.listProjectTeams({
      organizationSlug,
      projectSlug: params.projectSlug,
    });
    const isAssigned = currentTeams.some(
      (team) => team.slug === params.teamSlug,
    );

    if (!isAssigned) {
      throw new UserInputError(
        "The specified team is not assigned to this project. Choose one of the current project teams before removing access.",
      );
    }

    if (currentTeams.length <= 1) {
      throw new UserInputError(
        "Cannot remove the last team assigned to a project. Add another team to the project before removing this team.",
      );
    }

    await apiService.removeTeamFromProject({
      organizationSlug,
      projectSlug: params.projectSlug,
      teamSlug: params.teamSlug,
    });

    const updatedTeams = await apiService.listProjectTeams({
      organizationSlug,
      projectSlug: params.projectSlug,
    });

    return formatResponse({
      organizationSlug,
      projectSlug: params.projectSlug,
      teamSlug: params.teamSlug,
      teams: updatedTeams,
    });
  },
});
