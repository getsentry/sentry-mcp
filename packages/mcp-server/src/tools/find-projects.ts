import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import {
  apiServiceFromContext,
  withApiErrorHandling,
} from "../internal/tool-helpers/api";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../schema";
import type { Project } from "../api-client/index";

export default defineTool({
  name: "find_projects",
  description: [
    "Find projects in Sentry.",
    "",
    "Use this tool when you need to:",
    "- View all projects in a Sentry organization",
    "- Find a project's slug to aid other tool requests",
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

    let projects: Project[];

    // When constrained to a specific project, fetch it directly instead of listing all
    if (context.constraints.projectSlug) {
      try {
        const project = await withApiErrorHandling(
          () =>
            apiService.getProject({
              organizationSlug,
              projectSlugOrId: context.constraints.projectSlug,
            }),
          {
            organizationSlug,
            projectSlugOrId: context.constraints.projectSlug,
          },
        );
        projects = [project];
      } catch (error: any) {
        // If we get a 404 UserInputError, the project doesn't exist or user lacks access
        if (error instanceof UserInputError && error.cause?.status === 404) {
          projects = [];
        } else {
          throw error;
        }
      }
    } else {
      // No constraint, fetch all projects
      projects = await withApiErrorHandling(
        () => apiService.listProjects(organizationSlug),
        { organizationSlug },
      );
    }

    let output = `# Projects in **${organizationSlug}**\n\n`;

    // Add note if constrained
    if (context.constraints.projectSlug) {
      output += `*Note: This MCP session is constrained to project **${context.constraints.projectSlug}**. Project parameters will be automatically provided to tools.*\n\n`;
    }

    if (projects.length === 0) {
      if (context.constraints.projectSlug) {
        output += `The constrained project **${context.constraints.projectSlug}** was not found in this organization or you don't have access to it.\n`;
      } else {
        output += "No projects found.\n";
      }
      return output;
    }
    output += projects.map((project) => `- **${project.slug}**\n`).join("");
    return output;
  },
});
