import type { z } from "zod";
import {
  type AutofixRunStepDefaultSchema,
  type AutofixRunStepRootCauseAnalysisSchema,
  type AutofixRunStepSchema,
  type AutofixRunStepSolutionSchema,
  type ClientKey,
  SentryApiService,
} from "./api-client/index";
import { formatIssueOutput } from "./internal/formatting";
import { parseIssueParams } from "./internal/issue-helpers";
import { logError } from "./logging";
import type { ServerContext, ToolHandlers } from "./types";
import { setTag } from "@sentry/core";

function apiServiceFromContext(
  context: ServerContext,
  opts: { regionUrl?: string } = {},
) {
  return new SentryApiService({
    host: opts.regionUrl ? new URL(opts.regionUrl).host : context.host,
    accessToken: context.accessToken,
  });
}

export const TOOL_HANDLERS = {
  list_organizations: async (context) => {
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
          `**Web URL:** ${org.links.organizationUrl}`,
          `**Region URL:** ${org.links.regionUrl}`,
        ].join("\n"),
      )
      .join("\n\n");

    output += "\n\n# Using this information\n\n";
    output += `- The organization's name is the identifier for the organization, and is used in many tools for \`organizationSlug\`.\n`;
    output += `- If a tool supports passing in the \`regionUrl\`, you should also pass in the correct value there.\n`;

    return output;
  },
  list_teams: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    let organizationSlug = params.organizationSlug;
    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }
    if (!organizationSlug) {
      throw new Error("Organization slug is required");
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
  list_projects: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    let organizationSlug = params.organizationSlug;
    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }
    if (!organizationSlug) {
      throw new Error("Organization slug is required");
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
  list_issues: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    let organizationSlug = params.organizationSlug;
    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }
    if (!organizationSlug) {
      throw new Error("Organization slug is required");
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
  list_releases: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    let organizationSlug = params.organizationSlug;
    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }
    if (!organizationSlug) {
      throw new Error("Organization slug is required");
    }
    setTag("organization.slug", organizationSlug);

    const releases = await apiService.listReleases({
      organizationSlug,
      projectSlug: params.projectSlug,
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
    output += `- You can search for issues in a specific release using the \`search_errors()\` tool with the query \`release:${releases.length ? releases[0]!.version : "VERSION"}\`.\n`;
    return output;
  },
  list_tags: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    let organizationSlug = params.organizationSlug;
    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }
    if (!organizationSlug) {
      throw new Error("Organization slug is required");
    }
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
      const orgSlug = params.organizationSlug ?? context.organizationSlug;
      if (!orgSlug) {
        throw new Error("Organization slug is required");
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

    const { organizationSlug: orgSlug, issueId: parsedIssueId } =
      parseIssueParams({
        organizationSlug: params.organizationSlug ?? context.organizationSlug,
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
  search_errors: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    let organizationSlug = params.organizationSlug;
    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }
    if (!organizationSlug) {
      throw new Error("Organization slug is required");
    }
    setTag("organization.slug", organizationSlug);

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
  search_transactions: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    let organizationSlug = params.organizationSlug;
    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }
    if (!organizationSlug) {
      throw new Error("Organization slug is required");
    }
    setTag("organization.slug", organizationSlug);

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
      output += `## ${eventSummary.transaction}\n\n`;
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
    let organizationSlug = params.organizationSlug;
    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }
    if (!organizationSlug) {
      throw new Error("Organization slug is required");
    }
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
    let organizationSlug = params.organizationSlug;
    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }
    if (!organizationSlug) {
      throw new Error("Organization slug is required");
    }
    setTag("organization.slug", organizationSlug);

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
  create_dsn: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    let organizationSlug = params.organizationSlug;
    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }
    if (!organizationSlug) {
      throw new Error("Organization slug is required");
    }
    setTag("organization.slug", organizationSlug);

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
  list_dsns: async (context, params) => {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    let organizationSlug = params.organizationSlug;
    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }
    if (!organizationSlug) {
      throw new Error("Organization slug is required");
    }
    setTag("organization.slug", organizationSlug);

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
        organizationSlug: params.organizationSlug ?? context.organizationSlug,
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
        organizationSlug: params.organizationSlug ?? context.organizationSlug,
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
