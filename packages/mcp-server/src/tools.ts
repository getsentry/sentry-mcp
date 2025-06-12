/**
 * Tool implementation handlers for the Sentry MCP server.
 *
 * Contains runtime implementations for all MCP tools defined in `toolDefinitions.ts`.
 * Each handler processes tool invocations, validates parameters, calls the Sentry API,
 * and returns markdown-formatted responses.
 *
 * @example Basic Handler Pattern
 * ```typescript
 * tool_name: async (context, params) => {
 *   if (!params.organizationSlug) {
 *     throw new UserInputError("Organization slug is required");
 *   }
 *
 *   const apiService = apiServiceFromContext(context, {
 *     regionUrl: params.regionUrl,
 *   });
 *   setTag("organization.slug", params.organizationSlug);
 *
 *   const results = await apiService.someMethod(params);
 *   return `# Results\n\n${formatResults(results)}`;
 * },
 * ```
 */
import type { z } from "zod";
import {
  type AutofixRunStepDefaultSchema,
  type AutofixRunStepRootCauseAnalysisSchema,
  type AutofixRunStepSchema,
  type AutofixRunStepSolutionSchema,
  type ClientKey,
  type Project,
  SentryApiService,
  type AssignedTo,
} from "./api-client/index";
import { formatIssueOutput } from "./internal/formatting";
import { parseIssueParams } from "./internal/issue-helpers";
import { logError } from "./logging";
import type { ServerContext, ToolHandlers } from "./types";
import { setTag } from "@sentry/core";
import { UserInputError } from "./errors";

function apiServiceFromContext(
  context: ServerContext,
  opts: { regionUrl?: string } = {},
) {
  let host = context.host;

  if (opts.regionUrl) {
    try {
      host = new URL(opts.regionUrl).host;
    } catch (error) {
      throw new UserInputError(
        `Invalid regionUrl provided: ${opts.regionUrl}. Must be a valid URL.`,
      );
    }
  }

  return new SentryApiService({
    host,
    accessToken: context.accessToken,
  });
}

export const TOOL_HANDLERS = {
  whoami: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const user = await apiService.getAuthenticatedUser();
    return `You are authenticated as ${user.name} (${user.email}).\n\nYour Sentry User ID is ${user.id}.`;
  },
  find_organizations: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizations = await apiService.listOrganizations();

    let output = "# Organizations\n\n";

    if (organizations.length === 0) {
      output += "You don't appear to be a member of any organizations.\n";
      return output;
    }

    output += organizations
      .map((org) =>
        [
          `## **${org.slug}**`,
          "",
          `**Web URL:** ${org.links.organizationUrl}`,
          `**Region URL:** ${org.links.regionUrl}`,
        ].join("\n"),
      )
      .join("\n\n");

    output += "\n\n# Using this information\n\n";
    output += `- The organization's name is the identifier for the organization, and is used in many tools for \`organizationSlug\`.\n`;
    output += `- If a tool supports passing in the \`regionUrl\`, you MUST pass in the correct value there.\n`;

    return output;
  },
  find_teams: async (context, params) => {
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
  find_projects: async (context, params) => {
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

    const projects = await apiService.listProjects(organizationSlug);
    let output = `# Projects in **${organizationSlug}**\n\n`;
    if (projects.length === 0) {
      output += "No projects found.\n";
      return output;
    }
    output += projects.map((project) => `- **${project.slug}**\n`).join("");
    return output;
  },
  find_issues: async (context, params) => {
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

    const sortByMap = {
      last_seen: "date" as const,
      first_seen: "new" as const,
      count: "freq" as const,
      userCount: "user" as const,
    };
    const issues = await apiService.listIssues({
      organizationSlug,
      projectSlug: params.projectSlug,
      query: params.query,
      sortBy: params.sortBy
        ? sortByMap[params.sortBy as keyof typeof sortByMap]
        : undefined,
    });
    let output = `# Issues in **${organizationSlug}${params.projectSlug ? `/${params.projectSlug}` : ""}**\n\n`;
    if (issues.length === 0) {
      output += "No issues found.\n";
      return output;
    }
    output += issues
      .map((issue) =>
        [
          `## ${issue.shortId}`,
          "",
          `**Description**: ${issue.title}`,
          `**Culprit**: ${issue.culprit}`,
          `**First Seen**: ${new Date(issue.firstSeen).toISOString()}`,
          `**Last Seen**: ${new Date(issue.lastSeen).toISOString()}`,
          `**URL**: ${apiService.getIssueUrl(organizationSlug, issue.shortId)}`,
        ].join("\n"),
      )
      .join("\n\n");
    output += "\n\n";
    output += "# Using this information\n\n";
    output += `- You can reference the Issue ID in commit messages (e.g. \`Fixes <issueID>\`) to automatically close the issue when the commit is merged.\n`;
    output += `- You can get more details about a specific issue by using the tool: \`get_issue_details(organizationSlug="${organizationSlug}", issueId=<issueID>)\`\n`;
    return output;
  },
  find_releases: async (context, params) => {
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
  find_tags: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);

    const tagList = await apiService.listTags({ organizationSlug }, {});
    let output = `# Tags in **${organizationSlug}**\n\n`;
    if (tagList.length === 0) {
      output += "No tags found.\n";
      return output;
    }
    output += tagList.map((tag) => [`- ${tag.key}`].join("\n")).join("\n");
    output += "\n\n";
    output += "# Using this information\n\n";
    output += `- You can reference tags in the \`query\` parameter of various tools: \`tagName:tagValue\`.\n`;
    return output;
  },
  get_issue_details: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });

    if (params.eventId) {
      const orgSlug = params.organizationSlug;
      if (!orgSlug) {
        throw new UserInputError(
          "`organizationSlug` is required when providing `eventId`",
        );
      }

      setTag("organization.slug", orgSlug);
      const [issue] = await apiService.listIssues({
        organizationSlug: orgSlug,
        query: params.eventId,
      });
      if (!issue) {
        return `# Event Not Found\n\nNo issue found for Event ID: ${params.eventId}`;
      }
      const event = await apiService.getEventForIssue({
        organizationSlug: orgSlug,
        issueId: issue.shortId,
        eventId: params.eventId,
      });
      return formatIssueOutput({
        organizationSlug: orgSlug,
        issue,
        event,
        apiService,
      });
    }

    // Validate that we have the minimum required parameters
    if (!params.issueUrl && !params.issueId) {
      throw new UserInputError(
        "Either `issueId` or `issueUrl` must be provided",
      );
    }

    if (!params.issueUrl && !params.organizationSlug) {
      throw new UserInputError(
        "`organizationSlug` is required when providing `issueId`",
      );
    }

    const { organizationSlug: orgSlug, issueId: parsedIssueId } =
      parseIssueParams({
        organizationSlug: params.organizationSlug,
        issueId: params.issueId,
        issueUrl: params.issueUrl,
      });
    setTag("organization.slug", orgSlug);

    const [issue, event] = await Promise.all([
      apiService.getIssue({
        organizationSlug: orgSlug,
        issueId: parsedIssueId!,
      }),
      apiService.getLatestEventForIssue({
        organizationSlug: orgSlug,
        issueId: parsedIssueId!,
      }),
    ]);

    return formatIssueOutput({
      organizationSlug: orgSlug,
      issue,
      event,
      apiService,
    });
  },
  update_issue: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });

    // Validate that we have the minimum required parameters
    if (!params.issueUrl && !params.issueId) {
      throw new UserInputError(
        "Either `issueId` or `issueUrl` must be provided",
      );
    }

    if (!params.issueUrl && !params.organizationSlug) {
      throw new UserInputError(
        "`organizationSlug` is required when providing `issueId`",
      );
    }

    // Validate that at least one update parameter is provided
    if (!params.status && !params.assignedTo) {
      throw new UserInputError(
        "At least one of `status` or `assignedTo` must be provided to update the issue",
      );
    }

    const { organizationSlug: orgSlug, issueId: parsedIssueId } =
      parseIssueParams({
        organizationSlug: params.organizationSlug,
        issueId: params.issueId,
        issueUrl: params.issueUrl,
      });

    setTag("organization.slug", orgSlug);

    // Get current issue details first
    const currentIssue = await apiService.getIssue({
      organizationSlug: orgSlug,
      issueId: parsedIssueId!,
    });

    // Update the issue
    const updatedIssue = await apiService.updateIssue({
      organizationSlug: orgSlug,
      issueId: parsedIssueId!,
      status: params.status,
      assignedTo: params.assignedTo,
    });

    let output = `# Issue ${updatedIssue.shortId} Updated in **${orgSlug}**\n\n`;
    output += `**Issue**: ${updatedIssue.title}\n`;
    output += `**URL**: ${apiService.getIssueUrl(orgSlug, updatedIssue.shortId)}\n\n`;

    // Show what changed
    output += "## Changes Made\n\n";

    if (params.status && currentIssue.status !== params.status) {
      output += `**Status**: ${currentIssue.status} → **${params.status}**\n`;
    }

    if (params.assignedTo) {
      const oldAssignee = formatAssignedTo(currentIssue.assignedTo ?? null);
      const newAssignee =
        params.assignedTo === "me" ? "You" : params.assignedTo;
      output += `**Assigned To**: ${oldAssignee} → **${newAssignee}**\n`;
    }

    output += "\n## Current Status\n\n";
    output += `**Status**: ${updatedIssue.status}\n`;
    const currentAssignee = formatAssignedTo(updatedIssue.assignedTo ?? null);
    output += `**Assigned To**: ${currentAssignee}\n`;

    output += "\n# Using this information\n\n";
    output += `- The issue has been successfully updated in Sentry\n`;
    output += `- You can view the issue details using: \`get_issue_details(organizationSlug="${orgSlug}", issueId="${updatedIssue.shortId}")\`\n`;

    if (params.status === "resolved") {
      output += `- The issue is now marked as resolved and will no longer generate alerts\n`;
    } else if (params.status === "ignored") {
      output += `- The issue is now ignored and will not generate alerts until it escalates\n`;
    }

    return output;
  },
  find_errors: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);
    if (params.projectSlug) setTag("project.slug", params.projectSlug);

    const eventList = await apiService.searchErrors({
      organizationSlug,
      projectSlug: params.projectSlug,
      filename: params.filename,
      query: params.query,
      transaction: params.transaction,
      sortBy: params.sortBy as "last_seen" | "count" | undefined,
    });
    let output = `# Errors in **${organizationSlug}${params.projectSlug ? `/${params.projectSlug}` : ""}**\n\n`;
    if (params.query)
      output += `These errors match the query \`${params.query}\`\n`;
    if (params.filename)
      output += `These errors are limited to the file suffix \`${params.filename}\`\n`;
    output += "\n";
    if (eventList.length === 0) {
      output += `No results found\n\n`;
      output += `We searched within the ${organizationSlug} organization.\n\n`;
      return output;
    }
    for (const eventSummary of eventList) {
      output += `## ${eventSummary.issue}\n\n`;
      output += `**Description**: ${eventSummary.title}\n`;
      output += `**Issue ID**: ${eventSummary.issue}\n`;
      output += `**URL**: ${apiService.getIssueUrl(organizationSlug, eventSummary.issue)}\n`;
      output += `**Project**: ${eventSummary.project}\n`;
      output += `**Last Seen**: ${eventSummary["last_seen()"]}\n`;
      output += `**Occurrences**: ${eventSummary["count()"]}\n\n`;
    }
    output += "# Using this information\n\n";
    output += `- You can reference the Issue ID in commit messages (e.g. \`Fixes <issueID>\`) to automatically close the issue when the commit is merged.\n`;
    output += `- You can get more details about an error by using the tool: \`get_issue_details(organizationSlug="${organizationSlug}", issueId=<issueID>)\`\n`;
    return output;
  },
  find_transactions: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);
    if (params.projectSlug) setTag("project.slug", params.projectSlug);

    const eventList = await apiService.searchSpans({
      organizationSlug,
      projectSlug: params.projectSlug,
      transaction: params.transaction,
      query: params.query,
      sortBy: params.sortBy as "timestamp" | "duration" | undefined,
    });
    let output = `# Transactions in **${organizationSlug}${params.projectSlug ? `/${params.projectSlug}` : ""}**\n\n`;
    if (params.query)
      output += `These spans match the query \`${params.query}\`\n`;
    if (params.transaction)
      output += `These spans are limited to the transaction \`${params.transaction}\`\n`;
    output += "\n";
    if (eventList.length === 0) {
      output += `No results found\n\n`;
      output += `We searched within the ${organizationSlug} organization.\n\n`;
      return output;
    }
    for (const eventSummary of eventList) {
      output += `## \`${eventSummary.transaction}\`\n\n`;
      output += `**Span ID**: ${eventSummary.id}\n`;
      output += `**Trace ID**: ${eventSummary.trace}\n`;
      output += `**Span Operation**: ${eventSummary["span.op"]}\n`;
      output += `**Span Description**: ${eventSummary["span.description"]}\n`;
      output += `**Duration**: ${eventSummary["span.duration"]}\n`;
      output += `**Timestamp**: ${eventSummary.timestamp}\n`;
      output += `**Project**: ${eventSummary.project}\n`;
      output += `**URL**: ${apiService.getTraceUrl(organizationSlug, eventSummary.trace)}\n\n`;
    }
    return output;
  },
  create_team: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);

    const team = await apiService.createTeam({
      organizationSlug,
      name: params.name,
    });
    let output = `# New Team in **${organizationSlug}**\n\n`;
    output += `**ID**: ${team.id}\n`;
    output += `**Slug**: ${team.slug}\n`;
    output += `**Name**: ${team.name}\n`;
    output += "# Using this information\n\n";
    output += `- You should always inform the user of the Team Slug value.\n`;
    return output;
  },
  create_project: async (context, params) => {
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
  update_project: async (context, params) => {
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
        logError(err);
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
        logError(err);
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
  create_dsn: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);
    setTag("project.slug", params.projectSlug);

    const clientKey = await apiService.createClientKey({
      organizationSlug,
      projectSlug: params.projectSlug,
      name: params.name,
    });
    let output = `# New DSN in **${organizationSlug}/${params.projectSlug}**\n\n`;
    output += `**DSN**: ${clientKey.dsn.public}\n`;
    output += `**Name**: ${clientKey.name}\n\n`;
    output += "# Using this information\n\n";
    output +=
      "- The `SENTRY_DSN` value is a URL that you can use to initialize Sentry's SDKs.\n";
    return output;
  },
  find_dsns: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);
    setTag("project.slug", params.projectSlug);

    const clientKeys = await apiService.listClientKeys({
      organizationSlug,
      projectSlug: params.projectSlug,
    });
    let output = `# DSNs in **${organizationSlug}/${params.projectSlug}**\n\n`;
    if (clientKeys.length === 0) {
      output +=
        "No DSNs were found.\n\nYou can create new one using the `create_dsn` tool.";
      return output;
    }
    for (const clientKey of clientKeys) {
      output += `## ${clientKey.name}\n`;
      output += `**ID**: ${clientKey.id}\n`;
      output += `**DSN**: ${clientKey.dsn.public}\n\n`;
    }
    output += "# Using this information\n\n";
    output +=
      "- The `SENTRY_DSN` value is a URL that you can use to initialize Sentry's SDKs.\n";
    return output;
  },
  begin_seer_issue_fix: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const { organizationSlug: orgSlug, issueId: parsedIssueId } =
      parseIssueParams({
        organizationSlug: params.organizationSlug,
        issueId: params.issueId,
        issueUrl: params.issueUrl,
      });

    setTag("organization.slug", orgSlug);

    const data = await apiService.startAutofix({
      organizationSlug: orgSlug,
      issueId: parsedIssueId,
    });
    return [
      `# Issue Fix Started for Issue ${parsedIssueId}`,
      "",
      `**Run ID:**: ${data.run_id}`,
      "",
      "This operation may take some time, so you should call `get_seer_issue_fix_status()` to check the status of the analysis, and repeat the process until its finished.",
      "",
      "You should also inform the user that the operation may take some time, and give them updates whenever you check the status of the operation..",
      "",
      "```",
      params.issueUrl
        ? `get_seer_issue_fix_status(issueUrl="${params.issueUrl}")`
        : `get_seer_issue_fix_status(organizationSlug="${orgSlug}", issueId="${parsedIssueId}")`,
      "```",
    ].join("\n");
  },
  get_seer_issue_fix_status: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const { organizationSlug: orgSlug, issueId: parsedIssueId } =
      parseIssueParams({
        organizationSlug: params.organizationSlug,
        issueId: params.issueId,
        issueUrl: params.issueUrl,
      });
    setTag("organization.slug", orgSlug);
    const { autofix } = await apiService.getAutofixState({
      organizationSlug: orgSlug,
      issueId: parsedIssueId!,
    });
    let output = `# Issue Fix Status for Issue ${parsedIssueId}\n\n`;
    if (!autofix) {
      output += `No issue fix process found for ${parsedIssueId}.\n\nYou can initiate a new issue fix execution using the \`begin_seer_issue_fix\` tool.`;
      return output;
    }
    for (const step of autofix.steps) {
      output += getOutputForAutofixStep(step);
      output += "\n";
    }
    return output;
  },
  find_issue_alert_rules: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;
    const projectSlug = params.projectSlug;

    if (!organizationSlug) {
      throw new UserInputError(
        "Organization slug is required. Please provide an organizationSlug parameter.",
      );
    }

    if (!projectSlug) {
      throw new UserInputError(
        "Project slug is required. Please provide a projectSlug parameter.",
      );
    }

    setTag("organization.slug", organizationSlug);
    setTag("project.slug", projectSlug);

    const alertRules = await apiService.listIssueAlertRules({
      organizationSlug,
      projectSlug,
    });

    let output = `# Issue Alert Rules in **${organizationSlug}/${projectSlug}**\n\n`;

    if (alertRules.length === 0) {
      output += "No issue alert rules found.\n";
      return output;
    }

    output += alertRules
      .map((rule) => {
        const conditionsText =
          rule.conditions.length > 0
            ? rule.conditions
                .map((c) => c.name || c.id.split(".").pop() || c.id)
                .join(", ")
            : "None";
        const filtersText =
          rule.filters.length > 0
            ? rule.filters
                .map(
                  (f) =>
                    f.name || `${f.id.split(".").pop() || f.id}: ${f.value}`,
                )
                .join(", ")
            : "None";
        const actionsText =
          rule.actions.length > 0
            ? rule.actions
                .map((a) => a.name || a.id.split(".").pop() || a.id)
                .join(", ")
            : "None";

        return [
          `## ${rule.name}`,
          "",
          `**ID**: ${rule.id}`,
          `**Status**: ${rule.status}`,
          `**Frequency**: ${rule.frequency} minutes`,
          `**Environment**: ${rule.environment || "All environments"}`,
          `**Owner**: ${rule.owner || "None"}`,
          `**Conditions**: ${conditionsText}`,
          `**Filters**: ${filtersText}`,
          `**Actions**: ${actionsText}`,
          `**Action Match**: ${rule.actionMatch}`,
          `**Filter Match**: ${rule.filterMatch}`,
          `**Created**: ${new Date(rule.dateCreated).toISOString()}`,
          `**Snooze**: ${rule.snooze ? "Yes" : "No"}`,
        ].join("\n");
      })
      .join("\n\n");

    output += "\n\n# Using this information\n\n";
    output += `- You can get more details about a specific rule using: \`get_issue_alert_rule_details(organizationSlug="${organizationSlug}", projectSlug="${projectSlug}", ruleId=<ruleId>)\`\n`;
    output += `- You can delete a rule using: \`delete_issue_alert_rule(organizationSlug="${organizationSlug}", projectSlug="${projectSlug}", ruleId=<ruleId>)\`\n`;

    return output;
  },
  get_issue_alert_rule_details: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;
    const projectSlug = params.projectSlug;
    const ruleId = params.ruleId;

    if (!organizationSlug) {
      throw new UserInputError(
        "Organization slug is required. Please provide an organizationSlug parameter.",
      );
    }

    if (!projectSlug) {
      throw new UserInputError(
        "Project slug is required. Please provide a projectSlug parameter.",
      );
    }

    if (!ruleId) {
      throw new UserInputError(
        "Rule ID is required. Please provide a ruleId parameter.",
      );
    }

    setTag("organization.slug", organizationSlug);
    setTag("project.slug", projectSlug);

    const rule = await apiService.getIssueAlertRule({
      organizationSlug,
      projectSlug,
      ruleId,
    });

    const output = [
      `# Issue Alert Rule: **${rule.name}**`,
      "",
      `**ID**: ${rule.id}`,
      `**Project**: ${organizationSlug}/${projectSlug}`,
      `**Status**: ${rule.status}`,
      `**Frequency**: ${rule.frequency} minutes`,
      `**Environment**: ${rule.environment || "All environments"}`,
      `**Owner**: ${rule.owner || "None"}`,
      `**Action Match**: ${rule.actionMatch}`,
      `**Filter Match**: ${rule.filterMatch}`,
      `**Snooze**: ${rule.snooze ? "Yes" : "No"}`,
      "",
    ];

    if (rule.conditions.length > 0) {
      output.push("## Conditions");
      output.push("");
      for (const condition of rule.conditions) {
        const conditionName =
          condition.name || condition.id.split(".").pop() || condition.id;
        output.push(`- **${conditionName}**`);
        if (condition.interval)
          output.push(`  - Interval: ${condition.interval}`);
        if (condition.value) output.push(`  - Value: ${condition.value}`);
        if (condition.comparisonType)
          output.push(`  - Comparison: ${condition.comparisonType}`);
      }
      output.push("");
    }

    if (rule.filters.length > 0) {
      output.push("## Filters");
      output.push("");
      for (const filter of rule.filters) {
        const filterName =
          filter.name || `${filter.id.split(".").pop() || filter.id}`;
        output.push(`- **${filterName}**`);
        if (filter.value) output.push(`  - Value: ${filter.value}`);
        if (filter.match) output.push(`  - Match: ${filter.match}`);
        if (filter.key) output.push(`  - Key: ${filter.key}`);
        if (filter.attribute) output.push(`  - Attribute: ${filter.attribute}`);
      }
      output.push("");
    }

    if (rule.actions.length > 0) {
      output.push("## Actions");
      output.push("");
      for (const action of rule.actions) {
        const actionName =
          action.name || action.id.split(".").pop() || action.id;
        output.push(`- **${actionName}**`);
        if (action.targetType)
          output.push(`  - Target Type: ${action.targetType}`);
        if (action.targetIdentifier)
          output.push(`  - Target: ${action.targetIdentifier}`);
        if (action.fallthroughType)
          output.push(`  - Fallthrough: ${action.fallthroughType}`);
        if (action.workspace) output.push(`  - Workspace: ${action.workspace}`);
        if (action.channel) output.push(`  - Channel: ${action.channel}`);
        if (action.channel_id)
          output.push(`  - Channel ID: ${action.channel_id}`);
      }
      output.push("");
    }

    output.push("## Metadata");
    output.push("");
    output.push(`**Created**: ${new Date(rule.dateCreated).toISOString()}`);
    if (rule.createdBy) {
      output.push(
        `**Created By**: ${rule.createdBy.name} (${rule.createdBy.email})`,
      );
    }

    return output.join("\n");
  },
  delete_issue_alert_rule: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;
    const projectSlug = params.projectSlug;
    const ruleId = params.ruleId;

    if (!organizationSlug) {
      throw new UserInputError(
        "Organization slug is required. Please provide an organizationSlug parameter.",
      );
    }

    if (!projectSlug) {
      throw new UserInputError(
        "Project slug is required. Please provide a projectSlug parameter.",
      );
    }

    if (!ruleId) {
      throw new UserInputError(
        "Rule ID is required. Please provide a ruleId parameter.",
      );
    }

    setTag("organization.slug", organizationSlug);
    setTag("project.slug", projectSlug);

    await apiService.deleteIssueAlertRule({
      organizationSlug,
      projectSlug,
      ruleId,
    });

    return [
      `# Issue Alert Rule Deleted`,
      "",
      `Successfully deleted issue alert rule **${ruleId}** from project **${organizationSlug}/${projectSlug}**.`,
      "",
      "The alert rule has been permanently removed and will no longer trigger alerts.",
    ].join("\n");
  },
  update_issue_alert_rule: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;
    const projectSlug = params.projectSlug;
    const ruleId = params.ruleId;

    if (!organizationSlug) {
      throw new UserInputError(
        "Organization slug is required. Please provide an organizationSlug parameter.",
      );
    }

    if (!projectSlug) {
      throw new UserInputError(
        "Project slug is required. Please provide a projectSlug parameter.",
      );
    }

    if (!ruleId) {
      throw new UserInputError(
        "Rule ID is required. Please provide a ruleId parameter.",
      );
    }

    setTag("organization.slug", organizationSlug);
    setTag("project.slug", projectSlug);

    // Build the update payload
    const updatePayload: any = {};

    if (params.name !== undefined) updatePayload.name = params.name;
    if (params.frequency !== undefined)
      updatePayload.frequency = params.frequency;
    if (params.actionMatch !== undefined)
      updatePayload.actionMatch = params.actionMatch;
    if (params.filterMatch !== undefined)
      updatePayload.filterMatch = params.filterMatch;
    if (params.conditions !== undefined)
      updatePayload.conditions = params.conditions;
    if (params.filters !== undefined) updatePayload.filters = params.filters;
    if (params.actions !== undefined) updatePayload.actions = params.actions;
    if (params.owner !== undefined) updatePayload.owner = params.owner;
    if (params.environment !== undefined)
      updatePayload.environment = params.environment;

    if (Object.keys(updatePayload).length === 0) {
      throw new UserInputError(
        "At least one field must be provided to update the alert rule.",
      );
    }

    const updatedRule = await apiService.updateIssueAlertRule({
      organizationSlug,
      projectSlug,
      ruleId,
      ...updatePayload,
    });

    return [
      `# Issue Alert Rule Updated`,
      "",
      `Successfully updated issue alert rule **${updatedRule.name}** (ID: ${updatedRule.id}) in project **${organizationSlug}/${projectSlug}**.`,
      "",
      `**Status**: ${updatedRule.status}`,
      `**Frequency**: ${updatedRule.frequency} minutes`,
      `**Environment**: ${updatedRule.environment || "All environments"}`,
      `**Owner**: ${updatedRule.owner || "None"}`,
      "",
      "## Updated Configuration",
      "",
      `**Conditions**: ${updatedRule.conditions.length} configured`,
      `**Filters**: ${updatedRule.filters.length} configured`,
      `**Actions**: ${updatedRule.actions.length} configured`,
      `**Action Match**: ${updatedRule.actionMatch}`,
      `**Filter Match**: ${updatedRule.filterMatch}`,
      "",
      "The alert rule configuration has been successfully updated and is now active.",
    ].join("\n");
  },
  create_issue_alert_rule: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;
    const projectSlug = params.projectSlug;

    if (!organizationSlug) {
      throw new UserInputError(
        "Organization slug is required. Please provide an organizationSlug parameter.",
      );
    }

    if (!projectSlug) {
      throw new UserInputError(
        "Project slug is required. Please provide a projectSlug parameter.",
      );
    }

    if (!params.name) {
      throw new UserInputError(
        "Rule name is required. Please provide a name parameter.",
      );
    }

    if (!params.conditions || params.conditions.length === 0) {
      throw new UserInputError(
        "At least one condition is required. Please provide conditions parameter.",
      );
    }

    if (!params.actions || params.actions.length === 0) {
      throw new UserInputError(
        "At least one action is required. Please provide actions parameter.",
      );
    }

    setTag("organization.slug", organizationSlug);
    setTag("project.slug", projectSlug);

    const newRule = await apiService.createIssueAlertRule({
      organizationSlug,
      projectSlug,
      name: params.name,
      frequency: params.frequency,
      actionMatch: params.actionMatch,
      filterMatch: params.filterMatch,
      conditions: params.conditions,
      filters: params.filters,
      actions: params.actions,
      owner: params.owner,
      environment: params.environment,
    });

    return [
      `# Issue Alert Rule Created`,
      "",
      `Successfully created issue alert rule **${newRule.name}** (ID: ${newRule.id}) in project **${organizationSlug}/${projectSlug}**.`,
      "",
      `**Status**: ${newRule.status}`,
      `**Frequency**: ${newRule.frequency} minutes`,
      `**Environment**: ${newRule.environment || "All environments"}`,
      `**Owner**: ${newRule.owner || "None"}`,
      "",
      "## Configuration",
      "",
      `**Conditions**: ${newRule.conditions.length} configured`,
      `**Filters**: ${newRule.filters.length} configured`,
      `**Actions**: ${newRule.actions.length} configured`,
      `**Action Match**: ${newRule.actionMatch}`,
      `**Filter Match**: ${newRule.filterMatch}`,
      "",
      "The alert rule has been created and is now active. It will trigger alerts based on the configured conditions.",
      "",
      "# Using this information",
      "",
      `- You can view details using: \`get_issue_alert_rule_details(organizationSlug="${organizationSlug}", projectSlug="${projectSlug}", ruleId="${newRule.id}")\``,
      `- You can update the rule using: \`update_issue_alert_rule(organizationSlug="${organizationSlug}", projectSlug="${projectSlug}", ruleId="${newRule.id}")\``,
      `- You can delete the rule using: \`delete_issue_alert_rule(organizationSlug="${organizationSlug}", projectSlug="${projectSlug}", ruleId="${newRule.id}")\``,
    ].join("\n");
  },
} satisfies ToolHandlers;

function getOutputForAutofixStep(step: z.infer<typeof AutofixRunStepSchema>) {
  let output = `## ${step.title}\n\n`;

  if (step.status === "FAILED") {
    output += `**Sentry hit an error completing this step.\n\n`;
    return output;
  }

  if (step.status !== "COMPLETED") {
    output += `**Sentry is still working on this step. Please check back in a minute.**\n\n`;
    return output;
  }

  if (step.type === "root_cause_analysis") {
    const typedStep = step as z.infer<
      typeof AutofixRunStepRootCauseAnalysisSchema
    >;

    for (const cause of typedStep.causes) {
      if (typedStep.description) {
        output += `${typedStep.description}\n\n`;
      }
      for (const entry of cause.root_cause_reproduction) {
        output += `**${entry.title}**\n\n`;
        output += `${entry.code_snippet_and_analysis}\n\n`;
      }
    }
    return output;
  }

  if (step.type === "solution") {
    const typedStep = step as z.infer<typeof AutofixRunStepSolutionSchema>;
    output += `${typedStep.description}\n\n`;
    for (const entry of typedStep.solution) {
      output += `**${entry.title}**\n`;
      output += `${entry.code_snippet_and_analysis}\n\n`;
    }

    if (typedStep.status === "FAILED") {
      output += `**Sentry hit an error completing this step.\n\n`;
    } else if (typedStep.status !== "COMPLETED") {
      output += `**Sentry is still working on this step.**\n\n`;
    }

    return output;
  }

  const typedStep = step as z.infer<typeof AutofixRunStepDefaultSchema>;
  if (typedStep.insights && typedStep.insights.length > 0) {
    for (const entry of typedStep.insights) {
      output += `**${entry.insight}**\n`;
      output += `${entry.justification}\n\n`;
    }
  } else if (step.output_stream) {
    output += `${step.output_stream}\n`;
  }

  return output;
}

/**
 * Helper function to format assignedTo field for display
 */
function formatAssignedTo(assignedTo: AssignedTo): string {
  if (!assignedTo) {
    return "Unassigned";
  }

  if (typeof assignedTo === "string") {
    return assignedTo;
  }

  if (typeof assignedTo === "object" && assignedTo.name) {
    return assignedTo.name;
  }

  return "Unknown";
}
