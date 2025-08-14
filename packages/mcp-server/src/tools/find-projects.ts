import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import { ParamOrganizationSlug, ParamRegionUrl } from "../schema";
import { validateConstraints } from "../internal/constraint-validation";

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

    // Validate organization constraints
    validateConstraints({ organizationSlug }, context);

    setTag("organization.slug", organizationSlug);

    const projects = await apiService.listProjects(organizationSlug);
    let output = `# Projects in **${organizationSlug}**\n\n`;
    if (projects.length === 0) {
      output += "No projects found.\n";
      return output;
    }
    output += projects.map((project) => `- **${project.slug}**\n`).join("");
    return output;
  },
});
