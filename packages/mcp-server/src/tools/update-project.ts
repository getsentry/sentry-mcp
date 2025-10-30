import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { logIssue } from "../telem/logging";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import type { Project } from "../api-client/index";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamProjectSlug,
  ParamPlatform,
  ParamTeamSlug,
} from "../schema";

export default defineTool({
  name: "update_project",
  requiredSkills: ["project-management"], // Only available in project-management skill
  requiredScopes: ["project:write"],
  description: [
    "Update project settings in Sentry, such as name, slug, platform, and team assignment.",
    "",
    "Be careful when using this tool!",
    "",
    "Use this tool when you need to:",
    "- Update a project's name or slug to fix onboarding mistakes",
    "- Change the platform assigned to a project",
    "- Update team assignment for a project",
    "",
    "<examples>",
    "### Update a project's name and slug",
    "",
    "```",
    "update_project(organizationSlug='my-organization', projectSlug='old-project', name='New Project Name', slug='new-project-slug')",
    "```",
    "",
    "### Assign a project to a different team",
    "",
    "```",
    "update_project(organizationSlug='my-organization', projectSlug='my-project', teamSlug='backend-team')",
    "```",
    "",
    "### Update platform",
    "",
    "```",
    "update_project(organizationSlug='my-organization', projectSlug='my-project', platform='python')",
    "```",
    "",
    "</examples>",
    "",
    "<hints>",
    "- If the user passes a parameter in the form of name/otherName, it's likely in the format of <organizationSlug>/<projectSlug>.",
    "- Team assignment is handled separately from other project settings",
    "- If any parameter is ambiguous, you should clarify with the user what they meant.",
    "- When updating the slug, the project will be accessible at the new slug after the update",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.optional(),
    projectSlug: ParamProjectSlug,
    name: z.string().trim().describe("The new name for the project").optional(),
    slug: z
      .string()
      .toLowerCase()
      .trim()
      .describe("The new slug for the project (must be unique)")
      .optional(),
    platform: ParamPlatform.optional(),
    teamSlug: ParamTeamSlug.optional().describe(
      "The team to assign this project to. Note: this will replace the current team assignment.",
    ),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);
    setTag("project.slug", params.projectSlug);

    // Handle team assignment separately if provided
    if (params.teamSlug) {
      setTag("team.slug", params.teamSlug);
      try {
        await apiService.addTeamToProject({
          organizationSlug,
          projectSlug: params.projectSlug,
          teamSlug: params.teamSlug,
        });
      } catch (err) {
        logIssue(err);
        throw new Error(
          `Failed to assign team ${params.teamSlug} to project ${params.projectSlug}: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    }

    // Update project settings if any are provided
    const hasProjectUpdates = params.name || params.slug || params.platform;

    let project: Project | undefined;
    if (hasProjectUpdates) {
      try {
        project = await apiService.updateProject({
          organizationSlug,
          projectSlug: params.projectSlug,
          name: params.name,
          slug: params.slug,
          platform: params.platform,
        });
      } catch (err) {
        logIssue(err);
        throw new Error(
          `Failed to update project ${params.projectSlug}: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    } else {
      // If only team assignment, fetch current project data for display
      const projects = await apiService.listProjects(organizationSlug);
      project = projects.find((p) => p.slug === params.projectSlug);
      if (!project) {
        throw new UserInputError(`Project ${params.projectSlug} not found`);
      }
    }

    let output = `# Updated Project in **${organizationSlug}**\n\n`;
    output += `**ID**: ${project.id}\n`;
    output += `**Slug**: ${project.slug}\n`;
    output += `**Name**: ${project.name}\n`;
    if (project.platform) {
      output += `**Platform**: ${project.platform}\n`;
    }

    // Display what was updated
    const updates: string[] = [];
    if (params.name) updates.push(`name to "${params.name}"`);
    if (params.slug) updates.push(`slug to "${params.slug}"`);
    if (params.platform) updates.push(`platform to "${params.platform}"`);
    if (params.teamSlug)
      updates.push(`team assignment to "${params.teamSlug}"`);

    if (updates.length > 0) {
      output += `\n## Updates Applied\n`;
      output += updates.map((update) => `- Updated ${update}`).join("\n");
      output += `\n`;
    }

    output += "\n# Using this information\n\n";
    output += `- The project is now accessible at slug: \`${project.slug}\`\n`;
    if (params.teamSlug) {
      output += `- The project is now assigned to the \`${params.teamSlug}\` team\n`;
    }
    return output;
  },
});
