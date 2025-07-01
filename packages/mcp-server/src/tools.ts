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
  ApiError,
} from "./api-client/index";
import { formatIssueOutput } from "./internal/formatting";
import { parseIssueParams } from "./internal/issue-helpers";
import { fetchWithTimeout } from "./internal/fetch-utils";
import { logError } from "./logging";
import type { ServerContext, ToolHandlers } from "./types";
import { setTag } from "@sentry/core";
import { UserInputError } from "./errors";

const SEER_POLLING_INTERVAL = 5000; // 5 seconds
const SEER_TIMEOUT = 5 * 60 * 1000; // 5 minutes

/**
 * Response from the search API endpoint
 */
interface SearchResponse {
  query: string;
  results: Array<{
    id: string;
    url: string;
    snippet: string;
    relevance: number;
  }>;
  error?: string;
}

/**
 * Convert autofix status to user-friendly display name
 */
function getStatusDisplayName(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "Complete";
    case "FAILED":
    case "ERROR":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
    case "NEED_MORE_INFORMATION":
      return "Needs More Information";
    case "WAITING_FOR_USER_RESPONSE":
      return "Waiting for Response";
    default:
      return status;
  }
}

/**
 * Creates a SentryApiService instance from server context with optional region override.
 *
 * For self-hosted Sentry compatibility, empty regionUrl values are ignored gracefully.
 * For Sentry's Cloud Service, regionUrl is used to route requests to the correct region.
 *
 * @param context - Server context containing default host and access token
 * @param opts - Options object containing optional regionUrl override
 * @returns Configured SentryApiService instance
 * @throws {UserInputError} When regionUrl is provided but invalid
 */
function apiServiceFromContext(
  context: ServerContext,
  opts: { regionUrl?: string } = {},
) {
  let host = context.host;

  if (opts.regionUrl?.trim()) {
    try {
      const parsedUrl = new URL(opts.regionUrl);

      // Validate that the URL has a proper protocol
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new UserInputError(
          `Invalid regionUrl provided: ${opts.regionUrl}. Must include protocol (http:// or https://).`,
        );
      }

      // Validate that the host is not just the protocol name
      if (parsedUrl.host === "https" || parsedUrl.host === "http") {
        throw new UserInputError(
          `Invalid regionUrl provided: ${opts.regionUrl}. The host cannot be just a protocol name.`,
        );
      }

      host = parsedUrl.host;
    } catch (error) {
      if (error instanceof UserInputError) {
        throw error;
      }
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
    // User data endpoints (like /auth/) should never use regionUrl
    // as they must always query the main API server, not region-specific servers
    const apiService = apiServiceFromContext(context);
    const user = await apiService.getAuthenticatedUser();
    return `You are authenticated as ${user.name} (${user.email}).\n\nYour Sentry User ID is ${user.id}.`;
  },
  find_organizations: async (context, params) => {
    // User data endpoints (like /users/me/regions/) should never use regionUrl
    // as they must always query the main API server, not region-specific servers
    const apiService = apiServiceFromContext(context);
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
          `**Web URL:** ${org.links?.organizationUrl || "Not available"}`,
          `**Region URL:** ${org.links?.regionUrl || ""}`,
        ].join("\n"),
      )
      .join("\n\n");

    output += "\n\n# Using this information\n\n";
    output += `- The organization's name is the identifier for the organization, and is used in many tools for \`organizationSlug\`.\n`;

    const hasValidRegionUrls = organizations.some((org) =>
      org.links?.regionUrl?.trim(),
    );

    if (hasValidRegionUrls) {
      output += `- If a tool supports passing in the \`regionUrl\`, you MUST pass in the correct value shown above for each organization.\n`;
      output += `- For Sentry's Cloud Service (sentry.io), always use the regionUrl to ensure requests go to the correct region.\n`;
    } else {
      output += `- This appears to be a self-hosted Sentry installation. You can omit the \`regionUrl\` parameter when using other tools.\n`;
      output += `- For self-hosted Sentry, the regionUrl is typically empty and not needed for API calls.\n`;
    }

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
  analyze_issue_with_seer: async (context, params) => {
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

    let output = `# Seer AI Analysis for Issue ${parsedIssueId}\n\n`;

    // Step 1: Check if analysis already exists
    let currentState = await apiService.getAutofixState({
      organizationSlug: orgSlug,
      issueId: parsedIssueId!,
    });

    // Step 2: Start analysis if none exists
    if (!currentState.autofix) {
      output += `Starting new analysis...\n\n`;
      const startResult = await apiService.startAutofix({
        organizationSlug: orgSlug,
        issueId: parsedIssueId,
        instruction: params.instruction,
      });
      output += `Analysis started with Run ID: ${startResult.run_id}\n\n`;

      // Give it a moment to initialize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Refresh state
      currentState = await apiService.getAutofixState({
        organizationSlug: orgSlug,
        issueId: parsedIssueId!,
      });
    } else {
      output += `Found existing analysis (Run ID: ${currentState.autofix.run_id})\n\n`;

      // FIX #1: Check if existing analysis is already complete
      const existingStatus = currentState.autofix.status;
      if (
        existingStatus === "COMPLETED" ||
        existingStatus === "FAILED" ||
        existingStatus === "ERROR" ||
        existingStatus === "CANCELLED" ||
        existingStatus === "NEED_MORE_INFORMATION" ||
        existingStatus === "WAITING_FOR_USER_RESPONSE"
      ) {
        // Return results immediately, no polling needed
        output += `## Analysis ${getStatusDisplayName(existingStatus)}\n\n`;

        for (const step of currentState.autofix.steps) {
          output += getOutputForAutofixStep(step);
          output += "\n";
        }

        if (existingStatus !== "COMPLETED") {
          output += `\n**Status**: ${existingStatus}\n`;

          // Add specific guidance for human-intervention states
          if (existingStatus === "NEED_MORE_INFORMATION") {
            output += `\nSeer needs additional information to continue the analysis. Please review the insights above and consider providing more context.\n`;
          } else if (existingStatus === "WAITING_FOR_USER_RESPONSE") {
            output += `\nSeer is waiting for your response to proceed. Please review the analysis and provide feedback.\n`;
          }
        }

        return output;
      }
    }

    // Step 3: Poll until complete or timeout (only for non-terminal states)
    const startTime = Date.now();
    let lastStatus = "";

    while (Date.now() - startTime < SEER_TIMEOUT) {
      if (!currentState.autofix) {
        output += `Error: Analysis state lost. Please try again.\n`;
        return output;
      }

      const status = currentState.autofix.status;

      // FIX #2: Check if completed (include all terminal states)
      if (
        status === "COMPLETED" ||
        status === "FAILED" ||
        status === "ERROR" ||
        status === "CANCELLED" ||
        status === "NEED_MORE_INFORMATION" ||
        status === "WAITING_FOR_USER_RESPONSE"
      ) {
        output += `## Analysis ${getStatusDisplayName(status)}\n\n`;

        // Add all step outputs
        for (const step of currentState.autofix.steps) {
          output += getOutputForAutofixStep(step);
          output += "\n";
        }

        if (status !== "COMPLETED") {
          output += `\n**Status**: ${status}\n`;

          // Add specific guidance for human-intervention states
          if (status === "NEED_MORE_INFORMATION") {
            output += `\nSeer needs additional information to continue the analysis. Please review the insights above and consider providing more context.\n`;
          } else if (status === "WAITING_FOR_USER_RESPONSE") {
            output += `\nSeer is waiting for your response to proceed. Please review the analysis and provide feedback.\n`;
          }
        }

        return output;
      }

      // Update status if changed
      if (status !== lastStatus) {
        const activeStep = currentState.autofix.steps.find(
          (step) =>
            step.status === "PROCESSING" || step.status === "IN_PROGRESS",
        );
        if (activeStep) {
          output += `Processing: ${activeStep.title}...\n`;
        }
        lastStatus = status;
      }

      // Wait before next poll
      await new Promise((resolve) =>
        setTimeout(resolve, SEER_POLLING_INTERVAL),
      );

      // Refresh state
      currentState = await apiService.getAutofixState({
        organizationSlug: orgSlug,
        issueId: parsedIssueId!,
      });
    }

    // Show current progress
    if (currentState.autofix) {
      output += `**Current Status**: ${currentState.autofix.status}\n\n`;
      for (const step of currentState.autofix.steps) {
        output += getOutputForAutofixStep(step);
        output += "\n";
      }
    }

    // Timeout reached
    output += `\n## Analysis Timed Out\n\n`;
    output += `The analysis is taking longer than expected (>${SEER_TIMEOUT / 1000}s).\n\n`;

    output += `\nYou can check the status later by running the same command again:\n`;
    output += `\`\`\`\n`;
    output += params.issueUrl
      ? `analyze_issue_with_seer(issueUrl="${params.issueUrl}")`
      : `analyze_issue_with_seer(organizationSlug="${orgSlug}", issueId="${parsedIssueId}")`;
    output += `\n\`\`\`\n`;

    return output;
  },

  search_docs: async (context, params) => {
    let output = `# Documentation Search Results\n\n`;
    output += `**Query**: "${params.query}"\n`;
    if (params.guide) {
      output += `**Guide**: ${params.guide}\n`;
    }
    output += `\n`;

    // Determine the host - use context.host if available, then check env var, otherwise default to production
    const host = context.mcpHost || "https://mcp.sentry.dev";
    const searchUrl = new URL("/api/search", host);

    const response = await fetchWithTimeout(
      searchUrl.toString(),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: params.query,
          maxResults: params.maxResults,
          guide: params.guide,
        }),
      },
      15000, // 15 second timeout
    );

    if (!response.ok) {
      // TODO: improve error responses with types
      const errorData = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      const errorMessage =
        errorData?.error || `Search failed with status ${response.status}`;
      throw new ApiError(errorMessage, response.status);
    }

    const data = (await response.json()) as SearchResponse;

    // Handle error in response
    if ("error" in data && data.error) {
      output += `**Error**: ${data.error}\n\n`;
      return output;
    }

    // Display results
    if (data.results.length === 0) {
      output += "No documentation found matching your query.\n\n";
      return output;
    }

    output += `Found ${data.results.length} match${data.results.length === 1 ? "" : "es"}\n\n`;

    output += `These are just snippets. Use \`get_doc(path='...')\` to fetch the full content.\n\n`;

    for (const [index, result] of data.results.entries()) {
      output += `## ${index + 1}. ${result.url}\n\n`;
      output += `**Path**: ${result.id}\n`;
      output += `**Relevance**: ${(result.relevance * 100).toFixed(1)}%\n\n`;
      if (index < 3) {
        output += "**Matching Context**\n";
        output += `> ${result.snippet.replace(/\n/g, "\n> ")}\n\n`;
      }
    }

    return output;
  },

  get_doc: async (context, params) => {
    setTag("doc.path", params.path);

    let output = `# Documentation Content\n\n`;
    output += `**Path**: ${params.path}\n\n`;

    // Validate path format
    if (!params.path.endsWith(".md")) {
      throw new UserInputError(
        "Invalid documentation path. Path must end with .md extension.",
      );
    }

    // Use docs.sentry.io for now - will be configurable via flag in the future
    const baseUrl = "https://docs.sentry.io";

    // Construct the full URL for the markdown file
    const docUrl = new URL(params.path, baseUrl);

    // Validate domain whitelist for security
    const allowedDomains = ["docs.sentry.io", "develop.sentry.io"];
    if (!allowedDomains.includes(docUrl.hostname)) {
      throw new UserInputError(
        `Invalid domain. Documentation can only be fetched from allowed domains: ${allowedDomains.join(", ")}`,
      );
    }

    const response = await fetchWithTimeout(
      docUrl.toString(),
      {
        headers: {
          Accept: "text/plain, text/markdown",
          "User-Agent": "Sentry-MCP/1.0",
        },
      },
      15000, // 15 second timeout
    );

    if (!response.ok) {
      if (response.status === 404) {
        output += `**Error**: Documentation not found at this path.\n\n`;
        output += `Please verify the path is correct. Common issues:\n`;
        output += `- Path should start with / (e.g., /platforms/javascript/guides/nextjs.md)\n`;
        output += `- Path should match exactly what's shown in search_docs results\n`;
        output += `- Some pages may have been moved or renamed\n\n`;
        output += `Try searching again with \`search_docs()\` to find the correct path.\n`;
        return output;
      }

      throw new ApiError(
        `Failed to fetch documentation: ${response.statusText}`,
        response.status,
      );
    }

    const content = await response.text();

    // Check if we got HTML instead of markdown (wrong path format)
    if (
      content.trim().startsWith("<!DOCTYPE") ||
      content.trim().startsWith("<html")
    ) {
      output += `> **Error**: Received HTML instead of markdown. The path may be incorrect.\n\n`;
      output += `Make sure to use the .md extension in the path.\n`;
      output += `Example: /platforms/javascript/guides/nextjs.md\n`;
      return output;
    }

    // Add the markdown content
    output += "---\n\n";
    output += content;
    output += "\n\n---\n\n";

    output += "## Using this documentation\n\n";
    output +=
      "- This is the raw markdown content from Sentry's documentation\n";
    output +=
      "- Code examples and configuration snippets can be copied directly\n";
    output +=
      "- Links in the documentation are relative to https://docs.sentry.io\n";
    output +=
      "- For more related topics, use `search_docs()` to find additional pages\n";

    return output;
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
