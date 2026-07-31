/**
 * sentry project create
 *
 * Create a new Sentry project.
 * Supports org/name positional syntax (like `gh repo create owner/repo`).
 *
 * ## Flow
 *
 * 1. Parse name arg → extract org prefix if present (e.g., "acme/my-app")
 * 2. Resolve org → CLI flag > env vars > config defaults > DSN auto-detection
 * 3. Resolve team → `--team` flag > auto-select single team > auto-create if empty
 * 4. Call `createProjectWithDsn` (creates project, fetches DSN, builds URL)
 * 5. Display results
 *
 * When the team is auto-selected or auto-created, the output includes a note
 * so the user knows which team was used and how to change it.
 */

import type { SentryContext } from "../../context.js";
import {
  type CreatedProjectDetails,
  createProjectWithAutoTeam,
  createProjectWithDsn,
  listTeams,
  MEMBER_PROJECT_CREATION_DISABLED_DETAIL,
} from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { buildCommand } from "../../lib/command.js";
import {
  ApiError,
  CliError,
  ContextError,
  ResolutionError,
  withAuthGuard,
} from "../../lib/errors.js";
import {
  formatProjectCreated,
  type ProjectCreatedResult,
} from "../../lib/formatters/human.js";
import { isPlainOutput } from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { buildMarkdownTable, type Column } from "../../lib/formatters/table.js";
import { renderTextTable } from "../../lib/formatters/text-table.js";
import { logger } from "../../lib/logger.js";
import { DRY_RUN_ALIASES, DRY_RUN_FLAG } from "../../lib/mutate-command.js";
import {
  COMMON_PLATFORMS,
  isValidPlatform,
  suggestPlatform,
} from "../../lib/platforms.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import {
  buildOrgNotFoundError,
  type ResolvedConcreteTeam,
  resolveOrCreateTeam,
} from "../../lib/resolve-team.js";
import { slugify } from "../../lib/utils.js";

const log = logger.withTag("project.create");

/** Full usage hint shown in errors and help text. */
const USAGE_HINT = "sentry project create <org>/<name> <platform>";

type CreateFlags = {
  readonly team?: string;
  readonly "dry-run": boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

/** Build a 3-column grid string from a flat list of platforms. */
function platformGrid(items: readonly string[]): string {
  const COLS = 3;
  const rows: string[][] = [];
  for (let i = 0; i < items.length; i += COLS) {
    const row = items.slice(i, i + COLS);
    while (row.length < COLS) {
      row.push("");
    }
    rows.push(row);
  }

  if (isPlainOutput()) {
    const columns: Column<string[]>[] = Array.from(
      { length: COLS },
      (_, ci) => ({
        header: " ",
        value: (row: string[]) => row[ci] ?? "",
      })
    );
    return buildMarkdownTable(rows, columns);
  }

  const [first, ...rest] = rows;
  return renderTextTable(first ?? [], rest, {
    headerSeparator: false,
  });
}

/**
 * Normalize common platform format mistakes.
 *
 * Sentry's SDK guide URLs use dots (e.g., `sentry.io/for/javascript.nextjs`)
 * but platform identifiers use hyphens (`javascript-nextjs`). Users often
 * copy the dot-notation directly. This auto-corrects dots to hyphens and
 * warns via consola logger, following the same pattern as `normalizeFields` in `api.ts`.
 *
 * Safe to auto-correct because the input is already invalid (dots are never
 * valid in platform identifiers) and the correction is unambiguous.
 */
function normalizePlatform(platform: string): string {
  if (!platform.includes(".")) {
    return platform;
  }
  const corrected = platform.replace(/\./g, "-");
  log.warn(
    `Platform '${platform}' uses '.' instead of '-' — interpreting as '${corrected}'`
  );
  return corrected;
}

/**
 * Check whether an API error is about an invalid platform value.
 * Relies on Sentry's error message wording — may need updating if the API changes.
 */
function isPlatformError(error: ApiError): boolean {
  const detail = error.detail ?? error.message;
  return detail.includes("platform") && detail.includes("Invalid");
}

/**
 * Build a user-friendly error message for missing or invalid platform.
 *
 * @param nameArg - The name arg (used in the usage example)
 * @param platform - The invalid platform string, if provided
 */
function buildPlatformError(nameArg: string, platform?: string): string {
  const heading = platform
    ? `Invalid platform '${platform}'.`
    : "Platform is required.";

  let didYouMean = "";
  if (platform) {
    const suggestions = suggestPlatform(platform);
    if (suggestions.length > 0) {
      didYouMean = `\nDid you mean?\n${platformGrid(suggestions)}`;
    }
  }

  const platformTable = platformGrid([...COMMON_PLATFORMS]);

  return (
    `${heading}\n` +
    didYouMean +
    "\nUsage:\n" +
    `  sentry project create ${nameArg} <platform>\n\n` +
    `Common platforms:\n\n${platformTable}\n` +
    "Run 'sentry project create <name> <platform>' with any valid Sentry platform identifier."
  );
}

/**
 * Disambiguate a 404 from the create project endpoint.
 *
 * The `/teams/{org}/{team}/projects/` endpoint returns 404 for both
 * a bad org and a bad team. This helper calls `listTeams` to determine
 * which is wrong, then throws an actionable error.
 *
 * Only called on the error path — no cost to the happy path.
 */
async function handleCreateProject404(opts: {
  orgSlug: string;
  teamSlug: string;
  name: string;
  platform: string;
  detectedFrom?: string;
}): Promise<never> {
  const { orgSlug, teamSlug, name, platform, detectedFrom } = opts;

  const teamsResult = await withAuthGuard(() => listTeams(orgSlug));
  const teams = teamsResult.ok ? teamsResult.value : null;
  const listTeamsError = teamsResult.ok ? null : teamsResult.error;

  // listTeams succeeded → org is valid, diagnose the team
  if (teams !== null) {
    const teamExists = teams.some((t) => t.slug === teamSlug);
    if (teamExists) {
      // Team is in the list but the create endpoint still returned 404 —
      // likely a permissions issue (rare; Sentry usually returns 403)
      throw new CliError(
        `Failed to create project '${name}' in ${orgSlug}.\n\n` +
          `Team '${teamSlug}' exists but the request was rejected. ` +
          "You may lack permission to create projects in this team."
      );
    }

    if (teams.length > 0) {
      throw new ResolutionError(
        `Team '${teamSlug}'`,
        `not found in ${orgSlug}`,
        `sentry project create ${orgSlug}/${name} ${platform} --team <team-slug>`,
        [`Available teams: ${teams.map((t) => t.slug).join(", ")}`]
      );
    }
    throw new CliError(
      `No teams found in ${orgSlug}.\n\n` +
        "Create a team first, then try again."
    );
  }

  // listTeams returned 404 → org doesn't exist
  // Delegates to shared helper that handles DSN org ID resolution and org listing
  if (listTeamsError instanceof ApiError && listTeamsError.status === 404) {
    return await buildOrgNotFoundError(orgSlug, USAGE_HINT, detectedFrom);
  }

  // listTeams failed for other reasons (403, 5xx, network) — can't disambiguate
  throw new ResolutionError(
    `Project '${name}' in ${orgSlug}`,
    "could not be created",
    `sentry project create ${orgSlug}/${name} ${platform} --team <team-slug>`,
    [
      "The organization or team may not exist, or you may lack access",
      `List teams: sentry team list ${orgSlug}/`,
    ]
  );
}

/**
 * Resolve the team to show in a --dry-run preview.
 *
 * Mirrors the non-dry-run fallback: if resolveOrCreateTeam 403s (member lacks
 * team:read), the real run would use POST /organizations/{org}/projects/ which
 * auto-creates a personal team. Show a placeholder instead of failing.
 */
async function resolveDryRunTeam(
  orgSlug: string,
  opts: {
    team?: string;
    detectedFrom?: string;
    autoCreateSlug: string;
  }
): Promise<ResolvedConcreteTeam> {
  try {
    return await resolveOrCreateTeam(orgSlug, {
      team: opts.team,
      detectedFrom: opts.detectedFrom,
      usageHint: USAGE_HINT,
      autoCreateSlug: opts.autoCreateSlug,
      dryRun: true,
    });
  } catch (error) {
    // 403 from listTeams: member lacks team:read. The real run falls back to the
    // org-scoped endpoint which auto-creates a personal team. Preview that outcome.
    if (!(error instanceof ApiError && error.status === 403) || opts.team) {
      throw error;
    }
    log.debug(
      "403 on listTeams in dry-run — previewing org-scoped fallback outcome"
    );
    return { slug: "team-<username>", source: "auto-created" };
  }
}

/**
 * Fallback project creation via POST /organizations/{org}/projects/.
 *
 * Used when the team-scoped flow 403s (member lacks project:write or can't
 * create teams). Returns the created project details plus the team slug the
 * server auto-created. Surfaces a clear policy error if the org has disabled
 * member project creation entirely.
 */
async function createProjectWithAutoTeamFallback(opts: {
  orgSlug: string;
  name: string;
  platform: string;
}): Promise<
  CreatedProjectDetails & {
    teamSlug: string;
    teamSource: ResolvedConcreteTeam["source"];
  }
> {
  const { orgSlug, name, platform } = opts;
  let result: Awaited<ReturnType<typeof createProjectWithAutoTeam>>;
  try {
    result = await createProjectWithAutoTeam(orgSlug, { name, platform });
  } catch (expError) {
    if (expError instanceof ApiError) {
      if (
        expError.status === 403 &&
        expError.detail?.includes(MEMBER_PROJECT_CREATION_DISABLED_DETAIL)
      ) {
        throw new ApiError(
          `Failed to create project '${name}' in ${orgSlug} (HTTP 403).\n\n` +
            "Your organization has disabled project creation for members.\n" +
            "Ask an org owner or manager to enable it in Organization Settings → Member Roles,\n" +
            "or ask them to create the project and add you to it.",
          403,
          expError.detail,
          expError.endpoint
        );
      }
      if (expError.status === 409) {
        const slug = slugify(name);
        throw new CliError(
          `A project named '${name}' already exists in ${orgSlug}.\n\n` +
            `View it: sentry project view ${orgSlug}/${slug}`
        );
      }
    }
    throw expError;
  }
  return {
    project: result.project,
    dsn: result.dsn,
    url: result.url,
    teamSlug: result.team_slug,
    teamSource: "auto-created",
  };
}

/**
 * Create a project (with DSN + URL) with user-friendly error handling.
 * Wraps API errors with actionable messages instead of raw HTTP status codes.
 */
async function createProjectWithErrors(opts: {
  orgSlug: string;
  teamSlug: string;
  name: string;
  platform: string;
  detectedFrom?: string;
}): Promise<CreatedProjectDetails> {
  const { orgSlug, teamSlug, name, platform } = opts;
  try {
    return await createProjectWithDsn(orgSlug, teamSlug, { name, platform });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 409) {
        const slug = slugify(name);
        throw new CliError(
          `A project named '${name}' already exists in ${orgSlug}.\n\n` +
            `View it: sentry project view ${orgSlug}/${slug}`
        );
      }
      if (error.status === 400 && isPlatformError(error)) {
        throw new CliError(buildPlatformError(`${orgSlug}/${name}`, platform));
      }
      if (error.status === 404) {
        // handleCreateProject404 always throws — cast needed because
        // createProjectWithDsn's return type differs from SentryProject
        return await (handleCreateProject404(opts) as never);
      }
      // Re-throw as ApiError (not CliError) so the 401–499 user-error
      // silencing in error-reporting.ts applies — e.g. 403 "Your organization
      // has disabled this feature for members" is a permission issue, not a
      // CLI bug. 5xx and network errors still get captured.
      //
      // The message is kept short — ApiError.format() appends `detail` and
      // `endpoint` on separate lines, so embedding them in the message would
      // duplicate the output.
      throw new ApiError(
        `Failed to create project '${name}' in ${orgSlug} (HTTP ${error.status}).`,
        error.status,
        error.detail,
        error.endpoint
      );
    }
    throw error;
  }
}

export const createCommand = buildCommand({
  docs: {
    brief: "Create a new project",
    fullDescription:
      "Create a new Sentry project in an organization.\n\n" +
      "The name supports org/name syntax to specify the organization explicitly.\n" +
      "If omitted, the org is auto-detected from config defaults.\n\n" +
      "Projects are created under a team. If the org has one team, it is used\n" +
      "automatically. If no teams exist, one is created. Otherwise, specify --team.\n\n" +
      "Examples:\n" +
      "  sentry project create my-app node\n" +
      "  sentry project create acme-corp/my-app javascript-nextjs\n" +
      "  sentry project create my-app python-django --team backend\n" +
      "  sentry project create my-app go --json",
  },
  output: {
    human: formatProjectCreated,
    jsonExclude: [
      "slugDiverged",
      "expectedSlug",
      "teamSource",
      "requestedPlatform",
    ],
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "name",
          brief: "Project name (supports org/name syntax)",
          parse: String,
          optional: true,
        },
        {
          placeholder: "platform",
          brief: "Project platform (e.g., node, python, javascript-nextjs)",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      team: {
        kind: "parsed",
        parse: String,
        brief: "Team to create the project under",
        optional: true,
      },
      "dry-run": DRY_RUN_FLAG,
    },
    aliases: { ...DRY_RUN_ALIASES, t: "team" },
  },
  async *func(
    this: SentryContext,
    flags: CreateFlags,
    nameArg?: string,
    platformArg?: string
  ) {
    const { cwd } = this;

    if (!nameArg) {
      throw new ContextError(
        "Project name",
        "sentry project create <name> <platform>",
        [
          `Use org/name syntax: ${USAGE_HINT}`,
          "Specify team: sentry project create <name> <platform> --team <slug>",
        ]
      );
    }

    if (!platformArg) {
      throw new CliError(buildPlatformError(nameArg));
    }

    const platform = normalizePlatform(platformArg);

    if (!isValidPlatform(platform)) {
      throw new CliError(buildPlatformError(nameArg, platform));
    }

    const parsed = parseOrgProjectArg(nameArg);

    let explicitOrg: string | undefined;
    let name: string;

    switch (parsed.type) {
      case "explicit":
        explicitOrg = parsed.org;
        name = parsed.project;
        break;
      case "project-search":
        name = parsed.projectSlug;
        break;
      case "org-all":
        throw new ContextError("Project name", USAGE_HINT, []);
      case "auto-detect":
        // Shouldn't happen — nameArg is a required positional
        throw new ContextError("Project name", USAGE_HINT, []);
      default: {
        const _exhaustive: never = parsed;
        throw new ContextError("Project name", String(_exhaustive), []);
      }
    }

    // Resolve organization
    const resolved = await resolveOrg({ org: explicitOrg, cwd });
    if (!resolved) {
      throw new ContextError("Organization", USAGE_HINT, [
        `Include org in name: ${USAGE_HINT}`,
      ]);
    }
    const orgSlug = resolved.org;

    const expectedSlug = slugify(name);

    // Dry-run mode: resolve team (or preview auto-create) without hitting create APIs
    if (flags["dry-run"]) {
      const team = await resolveDryRunTeam(orgSlug, {
        team: flags.team,
        detectedFrom: resolved.detectedFrom,
        autoCreateSlug: expectedSlug,
      });
      const result: ProjectCreatedResult = {
        project: { id: "", slug: expectedSlug, name, platform },
        orgSlug,
        teamSlug: team.slug,
        teamSource: team.source,
        requestedPlatform: platform,
        dsn: null,
        url: "",
        slugDiverged: false,
        expectedSlug,
        dryRun: true,
      };
      return yield new CommandOutput(result);
    }

    // If either step 403s (member can't create/see teams, or lacks project:write on
    // the team), fall back to POST /organizations/{org}/projects/ which mirrors
    // what the Sentry onboarding UI uses: auto-creates a personal team for the
    // caller and only requires project:read scope.
    let teamSlug: string;
    let teamSource: ResolvedConcreteTeam["source"];
    let projectDetails: CreatedProjectDetails;

    try {
      const team: ResolvedConcreteTeam = await resolveOrCreateTeam(orgSlug, {
        team: flags.team,
        detectedFrom: resolved.detectedFrom,
        usageHint: USAGE_HINT,
        autoCreateSlug: expectedSlug,
      });
      teamSlug = team.slug;
      teamSource = team.source;
      projectDetails = await createProjectWithErrors({
        orgSlug,
        teamSlug,
        name,
        platform,
        detectedFrom: resolved.detectedFrom,
      });
    } catch (error) {
      // 403 means the user lacks permission to create or access teams, or to
      // create projects on the resolved team. Fall back to the org-scoped endpoint
      // which requires only project:read and auto-creates a personal team.
      // Skip the fallback when --team was explicit: the 403 is meaningful there.
      if (!(error instanceof ApiError && error.status === 403) || flags.team) {
        throw error;
      }
      // Policy 403: org has disabled member project creation. The org-scoped
      // endpoint enforces the same flag — re-throw to avoid a wasted round-trip.
      if (error.detail?.includes(MEMBER_PROJECT_CREATION_DISABLED_DETAIL)) {
        throw error;
      }
      log.debug("403 on team-based flow — falling back to org-scoped endpoint");
      const fallback = await createProjectWithAutoTeamFallback({
        orgSlug,
        name,
        platform,
      });
      teamSlug = fallback.teamSlug;
      teamSource = fallback.teamSource;
      projectDetails = fallback;
    }

    const { project, dsn, url } = projectDetails;
    const result: ProjectCreatedResult = {
      project,
      orgSlug,
      teamSlug,
      teamSource,
      requestedPlatform: platform,
      dsn,
      url,
      slugDiverged: project.slug !== expectedSlug,
      expectedSlug,
    };

    return yield new CommandOutput(result);
  },
});
