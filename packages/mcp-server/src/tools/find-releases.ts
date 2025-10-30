import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import type { ServerContext } from "../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamProjectSlugOrAll,
} from "../schema";

export default defineTool({
  name: "find_releases",
  requiredSkills: ["inspect"], // Only available in inspect skill
  requiredScopes: ["project:read"],
  description: [
    "Find releases in Sentry.",
    "",
    "Use this tool when you need to:",
    "- Find recent releases in a Sentry organization",
    "- Find the most recent version released of a specific project",
    "- Determine when a release was deployed to an environment",
    "",
    "<examples>",
    "### Find the most recent releases in the 'my-organization' organization",
    "",
    "```",
    "find_releases(organizationSlug='my-organization')",
    "```",
    "",
    "### Find releases matching '2ce6a27' in the 'my-organization' organization",
    "",
    "```",
    "find_releases(organizationSlug='my-organization', query='2ce6a27')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectSlug>.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.optional(),
    projectSlug: ParamProjectSlugOrAll.optional(),
    query: z
      .string()
      .trim()
      .describe("Search for versions which contain the provided string.")
      .optional(),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);

    const releases = await apiService.listReleases({
      organizationSlug,
      projectSlug: params.projectSlug,
      query: params.query,
    });
    let output = `# Releases in **${organizationSlug}${params.projectSlug ? `/${params.projectSlug}` : ""}**\n\n`;
    if (releases.length === 0) {
      output += "No releases found.\n";
      return output;
    }
    output += releases
      .map((release) => {
        const releaseInfo = [
          `## ${release.shortVersion}`,
          "",
          `**Created**: ${new Date(release.dateCreated).toISOString()}`,
        ];
        if (release.dateReleased) {
          releaseInfo.push(
            `**Released**: ${new Date(release.dateReleased).toISOString()}`,
          );
        }
        if (release.firstEvent) {
          releaseInfo.push(
            `**First Event**: ${new Date(release.firstEvent).toISOString()}`,
          );
        }
        if (release.lastEvent) {
          releaseInfo.push(
            `**Last Event**: ${new Date(release.lastEvent).toISOString()}`,
          );
        }
        if (release.newGroups !== undefined) {
          releaseInfo.push(`**New Issues**: ${release.newGroups}`);
        }
        if (release.projects && release.projects.length > 0) {
          releaseInfo.push(
            `**Projects**: ${release.projects.map((p) => p.name).join(", ")}`,
          );
        }
        if (release.lastCommit) {
          releaseInfo.push("", `### Last Commit`, "");
          releaseInfo.push(`**Commit ID**: ${release.lastCommit.id}`);
          releaseInfo.push(`**Commit Message**: ${release.lastCommit.message}`);
          releaseInfo.push(
            `**Commit Author**: ${release.lastCommit.author.name}`,
          );
          releaseInfo.push(
            `**Commit Date**: ${new Date(release.lastCommit.dateCreated).toISOString()}`,
          );
        }
        if (release.lastDeploy) {
          releaseInfo.push("", `### Last Deploy`, "");
          releaseInfo.push(`**Deploy ID**: ${release.lastDeploy.id}`);
          releaseInfo.push(
            `**Environment**: ${release.lastDeploy.environment}`,
          );
          if (release.lastDeploy.dateStarted) {
            releaseInfo.push(
              `**Deploy Started**: ${new Date(release.lastDeploy.dateStarted).toISOString()}`,
            );
          }
          if (release.lastDeploy.dateFinished) {
            releaseInfo.push(
              `**Deploy Finished**: ${new Date(release.lastDeploy.dateFinished).toISOString()}`,
            );
          }
        }
        return releaseInfo.join("\n");
      })
      .join("\n\n");
    output += "\n\n";
    output += "# Using this information\n\n";
    output += `- You can reference the Release version in commit messages or documentation.\n`;
    output += `- You can search for issues in a specific release using the \`find_errors()\` tool with the query \`release:${releases.length ? releases[0]!.shortVersion : "VERSION"}\`.\n`;
    return output;
  },
});
