import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { UserInputError } from "../../errors";
import { logWarn } from "../../telem/logging";
import type { ServerContext } from "../../types";
import {
  ParamOrganizationSlug,
  ParamProjectSlug,
  ParamRegionUrl,
  ParamTeamSlug,
  ParamPlatform,
} from "../../schema";
import type { ClientKey, SentryApiService, Team } from "../../api-client/index";

type RepositoryMatch = {
  name: string;
  provider: {
    id: string;
  };
};

type TeamCandidate = Team & {
  dateCreated?: string;
  isMember?: boolean;
  hasAccess?: boolean;
};

const DEFAULT_TEAM_LOOKUP_LIMIT = 100;

/**
 * Choose a deterministic default team when create_project omits teamSlug.
 *
 * Rule (stable until upstream project-create gains an implied default):
 * 1. Prefer teams the caller is a member of (`isMember`), when that signal exists.
 * 2. Otherwise prefer teams with `hasAccess === true`, when that signal exists.
 * 3. Among remaining candidates, pick the earliest `dateCreated`, then lowest slug.
 */
export function selectDefaultTeam(teams: TeamCandidate[]): TeamCandidate | null {
  if (teams.length === 0) {
    return null;
  }

  const memberTeams = teams.filter((team) => team.isMember === true);
  const accessibleTeams = teams.filter((team) => team.hasAccess === true);
  const candidates =
    memberTeams.length > 0
      ? memberTeams
      : accessibleTeams.length > 0
        ? accessibleTeams
        : teams;

  return [...candidates].sort((left, right) => {
    const leftCreated = left.dateCreated
      ? Date.parse(left.dateCreated)
      : Number.POSITIVE_INFINITY;
    const rightCreated = right.dateCreated
      ? Date.parse(right.dateCreated)
      : Number.POSITIVE_INFINITY;

    if (leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }

    return left.slug.localeCompare(right.slug);
  })[0];
}

async function resolveTeamSlug({
  apiService,
  organizationSlug,
  teamSlug,
}: {
  apiService: SentryApiService;
  organizationSlug: string;
  teamSlug: string | null;
}): Promise<{ teamSlug: string; inferred: boolean }> {
  if (teamSlug) {
    return { teamSlug, inferred: false };
  }

  const teams = (await apiService.listTeams(organizationSlug, {
    limit: DEFAULT_TEAM_LOOKUP_LIMIT,
  })) as TeamCandidate[];
  const defaultTeam = selectDefaultTeam(teams);

  if (!defaultTeam) {
    throw new UserInputError(
      `No teams found in organization "${organizationSlug}". Create a team with create_team, or pass teamSlug explicitly.`,
    );
  }

  return { teamSlug: defaultTeam.slug, inferred: true };
}

function getUsableClientKey(clientKeys: ClientKey[]): ClientKey | undefined {
  return (
    clientKeys.find(
      (key) => key.name === "Default" && key.isActive && key.dsn.public,
    ) ?? clientKeys.find((key) => key.isActive && key.dsn.public)
  );
}

function findRepositoryMatch(
  repositories: RepositoryMatch[],
  repository: string,
): RepositoryMatch {
  const exactMatches = repositories.filter(
    (candidate) => candidate.name === repository,
  );
  const matches =
    exactMatches.length > 0 || repository.includes("/")
      ? exactMatches
      : repositories.filter((candidate) =>
          candidate.name.endsWith(`/${repository}`),
        );

  if (matches.length === 0) {
    throw new UserInputError(
      `Could not find repository "${repository}" in the organization. Make sure it is connected through a VCS integration before creating the project.`,
    );
  }

  if (matches.length > 1) {
    throw new UserInputError(
      `Repository "${repository}" matched multiple repositories. Provide the full repository name, such as owner/repo.`,
    );
  }

  return matches[0];
}

function getRepositoryProvider(repository: RepositoryMatch): string | null {
  return repository.provider.id.replace(/^integrations:/, "") || null;
}

async function getOrCreateClientKey({
  apiService,
  organizationSlug,
  projectSlug,
}: {
  apiService: SentryApiService;
  organizationSlug: string;
  projectSlug: string;
}): Promise<ClientKey | null> {
  let clientKey: ClientKey | undefined;

  try {
    clientKey = getUsableClientKey(
      await apiService.listClientKeys({
        organizationSlug,
        projectSlug,
      }),
    );
  } catch (err) {
    logWarn(err, {
      loggerScope: ["runtime", "project-management"],
      extra: { action: "list_project_client_keys" },
    });
  }

  if (clientKey) {
    return clientKey;
  }

  try {
    return await apiService.createClientKey({
      organizationSlug,
      projectSlug,
      name: "Default",
    });
  } catch (err) {
    logWarn(err, {
      loggerScope: ["runtime", "project-management"],
      extra: { action: "create_project_client_key" },
    });
    return null;
  }
}

export default defineTool({
  name: "create_project",
  skills: ["project-management"], // Only available in project-management skill
  requiredScopes: ["project:write", "team:read", "org:read"],
  description: [
    "Create a new project in Sentry (provisions DSN automatically).",
    "",
    "USE THIS TOOL WHEN USERS WANT TO:",
    "- 'Create a new project'",
    "- 'Set up a project for [app/service] with team [X]'",
    "- 'I need a new Sentry project'",
    "- Create project AND need DSN in one step",
    "- Create project and link an existing repository",
    "",
    "Returns the created project slug and a usable SENTRY_DSN when key setup succeeds.",
    "",
    "teamSlug is optional. When omitted, the project is created on a deterministic default team:",
    "prefer a team the caller belongs to, then the earliest created accessible team.",
    "Pass teamSlug explicitly when the caller cares which team owns the project.",
    "",
    "Be careful when using this tool!",
    "",
    "<examples>",
    "### Create new project without choosing a team",
    "```",
    "create_project(organizationSlug='my-organization', name='my-project', platform='javascript')",
    "```",
    "### Create new project with an explicit team",
    "```",
    "create_project(organizationSlug='my-organization', teamSlug='my-team', name='my-project', platform='javascript')",
    "```",
    "### Create project with an explicit slug",
    "```",
    "create_project(organizationSlug='my-organization', teamSlug='my-team', name='My Project', slug='my-project', platform='javascript')",
    "```",
    "### Create project and link to a repository",
    "```",
    "create_project(organizationSlug='my-organization', teamSlug='my-team', name='my-project', platform='javascript', repository='getsentry/sentry')",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- Omit teamSlug for headless onboarding when any sensible team is fine.",
    "- Use find_teams when the user needs to choose among multiple teams.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    teamSlug: ParamTeamSlug.describe(
      "Optional team slug. When omitted, uses a deterministic default team (prefer a team the caller belongs to, then the earliest created accessible team). Use find_teams to list teams.",
    )
      .nullable()
      .default(null),
    name: z
      .string()
      .trim()
      .describe(
        "The name of the project to create. Typically this is the name of the application or service. It is only used as a visual label in Sentry.",
      ),
    slug: ParamProjectSlug.describe("Optional project slug to create.")
      .nullable()
      .default(null),
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

    const { teamSlug, inferred: teamInferred } = await resolveTeamSlug({
      apiService,
      organizationSlug,
      teamSlug: params.teamSlug,
    });
    setTag("team.slug", teamSlug);

    // Resolve repository intent before creating the project so bad or ambiguous
    // repo input cannot leave behind an otherwise unwanted project.
    const repositoryMatch = params.repository
      ? findRepositoryMatch(
          await apiService.listRepos({
            organizationSlug,
          }),
          params.repository,
        )
      : null;

    const project = await apiService.createProject({
      organizationSlug,
      teamSlug,
      name: params.name,
      slug: params.slug,
      platform: params.platform,
    });

    let repositoryLinked = false;
    let repositoryLinkFailed = false;
    if (repositoryMatch) {
      try {
        const repositoryMapping = await apiService.linkProjectRepository({
          organizationSlug,
          projectSlug: project.slug,
          repository: repositoryMatch.name,
          provider: getRepositoryProvider(repositoryMatch),
        });
        repositoryLinked =
          repositoryMapping.errors === 0 &&
          repositoryMapping.mappings.some((mapping) =>
            ["created", "updated"].includes(mapping.status),
          );
        repositoryLinkFailed = !repositoryLinked;
      } catch (err) {
        // Repository linking happens after project creation; preserve the
        // project + DSN response and report the link failure in the output.
        logWarn(err, {
          loggerScope: ["runtime", "project-management"],
          extra: { action: "link_project_repository" },
        });
        repositoryLinkFailed = true;
      }
    }

    const clientKey = await getOrCreateClientKey({
      apiService,
      organizationSlug,
      projectSlug: project.slug,
    });
    const sentryDsn = clientKey?.dsn.public ?? null;

    let output = `# New Project in **${organizationSlug}**\n\n`;
    output += `**ID**: ${project.id}\n`;
    output += `**Slug**: ${project.slug}\n`;
    output += `**Name**: ${project.name}\n`;
    output += `**Team**: ${teamSlug}${teamInferred ? " (default)" : ""}\n`;
    output += `**SENTRY_DSN**: ${sentryDsn ?? "unavailable"}\n\n`;
    if (repositoryMatch && repositoryLinked) {
      output += `**Repository**: ${repositoryMatch.name} (linked)\n`;
      output += "**Code Mapping**: `/` -> `/`\n\n";
    } else if (repositoryMatch && repositoryLinkFailed) {
      output += `**Repository**: Found ${repositoryMatch.name} but failed to link it to the project. Check permissions and try linking manually.\n\n`;
    }
    output += "## Response Notes\n\n";
    if (sentryDsn) {
      output += `- Please tell the user the project slug and **SENTRY_DSN**.\n`;
      output += `- No additional DSN creation step is needed.\n`;
      output += `- The **SENTRY_DSN** value is used to initialize Sentry SDKs.\n`;
    } else {
      output += `- Please tell the user the project slug.\n`;
      output += `- Project creation succeeded, but SENTRY_DSN could not be retrieved or created.\n`;
      output += `- Use create_dsn for this project before initializing Sentry SDKs.\n`;
    }
    if (teamInferred) {
      output += `- teamSlug was omitted, so the project was created on default team \`${teamSlug}\`.\n`;
    }
    if (repositoryMatch && repositoryLinked) {
      output += `- Repository linked to project with a root code mapping: ${repositoryMatch.name}\n`;
    } else if (repositoryMatch && repositoryLinkFailed) {
      output += `- Project creation succeeded, but repository linking did not. Ask the user to confirm permissions or link the repository manually in Sentry.\n`;
    }
    return output;
  },
});
