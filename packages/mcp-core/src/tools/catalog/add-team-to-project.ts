import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import type { Team } from "../../api-client/index";
import type { ServerContext } from "../../types";
import {
  ParamOrganizationSlug,
  ParamProjectSlug,
  ParamRegionUrl,
  ParamTeamSlug,
} from "../../schema";

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
  alreadyAssigned,
}: {
  organizationSlug: string;
  projectSlug: string;
  teamSlug: string;
  teams: Team[];
  alreadyAssigned: boolean;
}): string {
  let output = alreadyAssigned
    ? `# Team Already Assigned in **${organizationSlug}**\n\n`
    : `# Team Access Granted in **${organizationSlug}**\n\n`;
  output += `**Project**: ${projectSlug}\n`;
  output += `**Team**: ${teamSlug}\n`;
  output += `**Result**: ${
    alreadyAssigned
      ? "No change was made because the team already had project access."
      : "Team access was granted."
  }\n\n`;
  output += "## Current Project Teams\n\n";
  output += formatProjectTeams(teams);
  output += "\n\n## Response Notes\n\n";
  output += `- Project slug for later requests: \`${projectSlug}\`\n`;
  output += `- Current team slugs: ${formatTeamSlugs(teams)}\n`;
  return output;
}

export default defineTool({
  name: "add_team_to_project",
  skills: ["project-management"],
  requiredScopes: ["project:write", "team:read", "org:read"],
  description: [
    "Grant a team access to an existing Sentry project.",
    "",
    "Use this tool when you need to:",
    "- Add another team to a project",
    "- Grant a team access without changing project metadata",
    "- Check whether a team already has project access before adding it",
    "",
    "<examples>",
    "add_team_to_project(organizationSlug='my-organization', projectSlug='my-project', teamSlug='my-team')",
    "</examples>",
    "",
    "<hints>",
    "- Team access changes are separate from project metadata updates.",
    "- If the team is already assigned, this tool returns the current team list without making another change.",
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
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);
    setTag("project.slug", params.projectSlug);
    setTag("team.slug", params.teamSlug);

    const currentTeams = await apiService.listProjectTeams({
      organizationSlug,
      projectSlug: params.projectSlug,
    });
    const alreadyAssigned = currentTeams.some(
      (team) => team.slug === params.teamSlug,
    );

    if (alreadyAssigned) {
      return formatResponse({
        organizationSlug,
        projectSlug: params.projectSlug,
        teamSlug: params.teamSlug,
        teams: currentTeams,
        alreadyAssigned: true,
      });
    }

    await apiService.addTeamToProject({
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
      alreadyAssigned: false,
    });
  },
});
