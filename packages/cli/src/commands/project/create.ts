/**
 * sentry project create
 *
 * Create one or more Sentry projects.
 * Supports `[<org>/]<name>:<platform>` pairs for one or more projects.
 *
 * ## Flow
 *
 * 1. Parse one or more name:platform pairs and extract any org prefix
 * 2. Resolve org → positional prefix > env vars > config defaults > DSN auto-detection
 *    (all names must share one org)
 * 3. Resolve one team for the batch
 * 4. Create each project under that team (fetch DSN, build URL)
 * 5. Display results (one block per project)
 *
 * Every project is a `name:platform` pair (e.g. `sentry project create
 * web:javascript api:python-django`). The platform must always be attached
 * with `:` — there is no space-separated form, with or without an explicit
 * org. Project names cannot contain whitespace.
 */

import type { SentryContext } from "../../context.js";
import {
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
  ValidationError,
  withAuthGuard,
} from "../../lib/errors.js";
import {
  formatProjectCreateOutput,
  type ProjectCreatedResult,
  type ProjectCreateOutput,
} from "../../lib/formatters/human.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { interactivePromptsAllowed } from "../../lib/interactive-prompts.js";
import { logger } from "../../lib/logger.js";
import { DRY_RUN_ALIASES, DRY_RUN_FLAG } from "../../lib/mutate-command.js";
import { renderPlatformGrid } from "../../lib/platform-grid.js";
import {
  COMMON_PLATFORMS,
  isValidPlatform,
  suggestPlatform,
} from "../../lib/platforms.js";
import {
  createProjectWithTeamFallback,
  ProjectCreationApiError,
} from "../../lib/project-creation.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import {
  buildOrgNotFoundError,
  type ChooseProjectTeam,
  type ResolvedConcreteTeam,
  resolveOrCreateTeam,
} from "../../lib/resolve-team.js";
import { chooseProjectTeam } from "../../lib/team-choice.js";
import { slugify } from "../../lib/utils.js";

const log = logger.withTag("project.create");
const WHITESPACE_RE = /\s/;

class ProjectTeamChoiceCancelledError extends Error {
  constructor() {
    super("Project team selection cancelled.");
    this.name = "ProjectTeamChoiceCancelledError";
  }
}

/** Whether this command invocation can safely display a terminal prompt. */
function canPromptForTeam(context: SentryContext): boolean {
  return (
    interactivePromptsAllowed() &&
    context.stdin.isTTY === true &&
    context.process.stdout.isTTY === true
  );
}

/** Adapt the shared team-choice flow to consola's plain terminal prompts. */
function createTeamChooser(
  context: SentryContext
): ChooseProjectTeam | undefined {
  if (!canPromptForTeam(context)) {
    return;
  }

  return async (teams) =>
    await chooseProjectTeam(teams, async (options) => {
      const response = await log.prompt(options.message, {
        type: "select",
        options: options.options,
        initial: options.initialValue,
        cancel: "null",
      });
      if (response === null) {
        throw new ProjectTeamChoiceCancelledError();
      }
      if (typeof response !== "string") {
        throw new CliError("Team selection returned an invalid response.");
      }
      const selected = options.options.find(
        (option) => option.value === response
      );
      if (!selected) {
        throw new CliError(`Unknown team selection '${response}'.`);
      }
      return selected.value;
    });
}

/** Full usage hint shown in errors and help text. */
const USAGE_HINT = "sentry project create [<org>/]<name>:<platform>...";

type CreateFlags = {
  readonly team?: string;
  readonly "dry-run": boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

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
 * @param nameArg - The project name to echo in the usage example
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
      didYouMean = `\nDid you mean?\n${renderPlatformGrid(suggestions)}`;
    }
  }

  const platformTable = renderPlatformGrid([...COMMON_PLATFORMS]);

  return (
    `${heading}\n` +
    didYouMean +
    "\nUsage:\n" +
    `  sentry project create ${nameArg}:<platform>\n\n` +
    `Common platforms:\n\n${platformTable}\n` +
    "Run 'sentry platform list' to see all valid platform identifiers.\n" +
    "Run 'sentry project create <name>:<platform>' with any valid Sentry platform identifier."
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
        `sentry project create ${orgSlug}/${name}:${platform} --team <team-slug>`,
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
    `sentry project create ${orgSlug}/${name}:${platform} --team <team-slug>`,
    [
      "The organization or team may not exist, or you may lack access",
      `List teams: sentry team list ${orgSlug}/`,
    ]
  );
}

/**
 * Resolve the team to show in a --dry-run preview.
 *
 * Mirrors the real resolver without mutating. When the real run would use the
 * org-scoped endpoint, show a personal-team placeholder.
 */
async function resolveDryRunTeam(
  orgSlug: string,
  opts: {
    team?: string;
    detectedFrom?: string;
    autoCreateSlug: string;
    chooseTeam?: ChooseProjectTeam;
  }
): Promise<ResolvedConcreteTeam> {
  const team = await resolveOrCreateTeam(orgSlug, {
    team: opts.team,
    detectedFrom: opts.detectedFrom,
    usageHint: USAGE_HINT,
    autoCreateSlug: opts.autoCreateSlug,
    dryRun: true,
    chooseTeam: opts.chooseTeam,
  });
  return team ?? { slug: "team-<username>", source: "auto-created" };
}

/** Inputs shared by both project-creation endpoints. */
type CreateProjectBaseOpts = {
  /** Organization slug that will own the project. */
  orgSlug: string;
  /** Project display name. */
  name: string;
  /** Validated Sentry platform identifier. */
  platform: string;
};

/**
 * A project with this name already exists in the org (HTTP 409). Shared by the
 * team-scoped and org-scoped fallback create paths so the "already exists"
 * message and the `project view` hint stay in one place.
 */
function projectExistsError(orgSlug: string, name: string): CliError {
  const slug = slugify(name);
  return new CliError(
    `A project named '${name}' already exists in ${orgSlug}.\n\n` +
      `View it: sentry project view ${orgSlug}/${slug}`
  );
}

/**
 * Map errors shared by both project-creation endpoints to actionable output.
 * Endpoint-specific errors must be handled before calling this function.
 */
function handleCreateApiError(
  error: ApiError,
  opts: CreateProjectBaseOpts
): never {
  const { orgSlug, name, platform } = opts;
  if (
    error.status === 403 &&
    error.detail?.includes(MEMBER_PROJECT_CREATION_DISABLED_DETAIL)
  ) {
    throw new ApiError(
      `Failed to create project '${name}' in ${orgSlug} (HTTP 403).\n\n` +
        "Your organization has disabled project creation for members.\n" +
        "Ask an org owner or manager to enable it in Organization Settings → Member Roles,\n" +
        "or ask them to create the project and add you to it.",
      403,
      error.detail,
      error.endpoint
    );
  }
  if (error.status === 409) {
    throw projectExistsError(orgSlug, name);
  }
  if (error.status === 400 && isPlatformError(error)) {
    throw new CliError(buildPlatformError(`${orgSlug}/${name}`, platform));
  }
  // Re-throw as ApiError (not CliError) so the 401–499 user-error silencing in
  // error-reporting.ts applies — e.g. a 403 "feature disabled for members" is a
  // permission issue, not a CLI bug. 5xx and network errors still get captured.
  // The message is kept short — ApiError.format() appends detail/endpoint.
  throw new ApiError(
    `Failed to create project '${name}' in ${orgSlug} (HTTP ${error.status}).`,
    error.status,
    error.detail,
    error.endpoint
  );
}

/** A validated project specification parsed from the command positionals. */
type ParsedProjectSpec = {
  /** Explicit organization slug, when the name used org/name syntax. */
  org?: string;
  /** Project display name. */
  name: string;
  /** Validated Sentry platform identifier. */
  platform: string;
};

/**
 * Parse and validate a project name independently from its platform source.
 * Project names cannot contain whitespace in either supported syntax.
 */
function parseProjectName(
  rawName: string,
  platform: string
): ParsedProjectSpec {
  if (rawName.trim() === "") {
    throw new ValidationError("Project name cannot be empty.", "name");
  }
  if (WHITESPACE_RE.test(rawName)) {
    throw new ValidationError(
      `Project name '${rawName}' cannot contain whitespace.`,
      "name"
    );
  }

  const parsedName = parseOrgProjectArg(rawName);
  switch (parsedName.type) {
    case "explicit":
      return {
        org: parsedName.org,
        name: parsedName.project,
        platform,
      };
    case "project-search":
      return {
        org: parsedName.org,
        name: parsedName.projectSlug,
        platform,
      };
    case "org-all":
      throw new ContextError("Project name", USAGE_HINT, [
        `'${rawName}' looks like an org, not a project name.`,
      ]);
    case "auto-detect":
      throw new ValidationError("Project name cannot be empty.", "name");
    default:
      throw new ContextError("Project name", USAGE_HINT, []);
  }
}

/** Validate and normalize a platform associated with a project name. */
function parseProjectPlatform(rawName: string, rawPlatform: string): string {
  const trimmedPlatform = rawPlatform.trim();
  if (trimmedPlatform === "") {
    throw new ValidationError(buildPlatformError(rawName), "platform");
  }
  const platform = normalizePlatform(trimmedPlatform);
  if (!isValidPlatform(platform)) {
    throw new ValidationError(
      buildPlatformError(rawName, platform),
      "platform"
    );
  }
  return platform;
}

/**
 * Parse one required `<name>:<platform>` pair. The final colon is the
 * separator so project names may contain earlier colons. There is no
 * space-separated fallback — the platform must always be attached with `:`,
 * with or without an explicit org prefix on the name.
 */
function parsePairedProjectSpec(rawSpec: string): ParsedProjectSpec {
  const separatorIndex = rawSpec.lastIndexOf(":");
  if (separatorIndex === -1) {
    throw new ValidationError(
      `Project '${rawSpec}' must use <name>:<platform> syntax.`,
      "project"
    );
  }

  const rawName = rawSpec.slice(0, separatorIndex);
  const platform = parseProjectPlatform(
    rawName,
    rawSpec.slice(separatorIndex + 1)
  );
  return parseProjectName(rawName, platform);
}

/**
 * Parse one or more `[<org>/]<name>:<platform>` pairs, then require explicit
 * org prefixes to agree. A lone positional with no colon at all gets a
 * friendlier "platform is required" error instead of the generic syntax error.
 */
function parseProjectSpecs(rawSpecs: readonly string[]): {
  explicitOrg?: string;
  parsed: ParsedProjectSpec[];
} {
  if (rawSpecs.length === 0) {
    throw new ContextError("Project specification", USAGE_HINT, []);
  }

  if (rawSpecs.length === 1 && !rawSpecs[0]?.includes(":")) {
    throw new ValidationError(
      buildPlatformError(rawSpecs[0] ?? ""),
      "platform"
    );
  }
  const parsed = rawSpecs.map(parsePairedProjectSpec);

  const orgs = new Set(
    parsed.map((p) => p.org).filter((o): o is string => Boolean(o))
  );
  if (orgs.size > 1) {
    throw new ValidationError(
      `Cannot create projects across multiple organizations (${[...orgs].join(", ")}).\n\n` +
        "All names must belong to the same org.",
      "organization"
    );
  }
  const [explicitOrg] = orgs;
  return { explicitOrg, parsed };
}

/**
 * Preserve the existing object shape for a single create while giving every
 * batch—complete or partial—a stable array shape.
 */
function buildProjectCreateOutput(
  results: ProjectCreatedResult[],
  requestedCount: number
): ProjectCreateOutput {
  const [singleResult] = results;
  return requestedCount === 1 && singleResult ? singleResult : results;
}

/**
 * Create a single project end-to-end (team resolve → create → fallback),
 * returning the display result. Handles --dry-run internally.
 */
async function createOneProject(opts: {
  orgSlug: string;
  name: string;
  platform: string;
  flags: CreateFlags;
  detectedFrom?: string;
  /**
   * Slug to use when auto-creating a team in an org with no teams. Shared
   * across a multi-project batch so every project lands in (or previews) the
   * one team the first project creates — rather than each resolving its own.
   */
  teamAutoCreateSlug?: string;
  /** Team already fixed by an earlier project in the same batch. */
  team?: ResolvedConcreteTeam;
  /** Interactive choice capability, omitted for JSON and non-TTY runs. */
  chooseTeam?: ChooseProjectTeam;
}): Promise<ProjectCreatedResult> {
  const { orgSlug, name, platform, flags, detectedFrom } = opts;
  const expectedSlug = slugify(name);
  const autoCreateSlug = opts.teamAutoCreateSlug ?? expectedSlug;

  if (flags["dry-run"]) {
    const team =
      opts.team ??
      (await resolveDryRunTeam(orgSlug, {
        team: flags.team,
        detectedFrom,
        autoCreateSlug,
        chooseTeam: opts.chooseTeam,
      }));
    return {
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
  }

  const team =
    opts.team ??
    (await resolveOrCreateTeam(orgSlug, {
      team: flags.team,
      detectedFrom,
      usageHint: USAGE_HINT,
      autoCreateSlug,
      chooseTeam: opts.chooseTeam,
    }));

  let projectDetails: Awaited<ReturnType<typeof createProjectWithTeamFallback>>;
  try {
    projectDetails = await createProjectWithTeamFallback({
      orgSlug,
      name,
      platform,
      team,
    });
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    if (
      error instanceof ProjectCreationApiError &&
      error.status === 404 &&
      error.route === "team" &&
      team
    ) {
      return await handleCreateProject404({
        orgSlug,
        teamSlug: team.slug,
        name,
        platform,
        detectedFrom,
      });
    }
    return handleCreateApiError(error, { orgSlug, name, platform });
  }

  const { project, dsn, url, teamSlug, teamSource } = projectDetails;
  return {
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
}

export const createCommand = buildCommand({
  docs: {
    brief: "Create one or more projects",
    customUsage: ["[<org>/]<name>:<platform>..."],
    fullDescription:
      "Create Sentry projects in an organization.\n\n" +
      "Names support org/name syntax to specify the organization explicitly.\n" +
      "If omitted, the org is auto-detected from config defaults. Project names\n" +
      "cannot contain whitespace.\n\n" +
      "Every project is a name:platform pair. Create several projects at once\n" +
      "by passing multiple pairs as separate arguments. All projects share one org.\n\n" +
      "Projects are created under a team. In an interactive terminal, choose to\n" +
      "create a new team or use a team where you are Team Admin. In non-interactive\n" +
      "runs, one eligible team is used automatically; multiple teams require --team.\n\n" +
      "Examples:\n" +
      "  sentry project create my-app:node\n" +
      "  sentry project create acme-corp/my-app:javascript-nextjs\n" +
      "  sentry project create web:javascript api:python-django worker:node\n" +
      "  sentry project create my-app:python-django --team backend\n" +
      "  sentry project create my-app:go --json",
  },
  output: {
    human: formatProjectCreateOutput,
    jsonExclude: [
      "slugDiverged",
      "expectedSlug",
      "teamSource",
      "requestedPlatform",
    ],
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "name:platform",
        brief: "One or more project name and platform pairs",
        parse: String,
      },
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
  async *func(this: SentryContext, flags: CreateFlags, ...args: string[]) {
    const { cwd } = this;

    const { explicitOrg, parsed } = parseProjectSpecs(args);

    // Resolve organization once — all projects are created in the same org.
    const resolved = await resolveOrg({ org: explicitOrg, cwd });
    if (!resolved) {
      throw new ContextError("Organization", USAGE_HINT, [
        `Include org in name: ${USAGE_HINT}`,
      ]);
    }
    const orgSlug = resolved.org;

    // If the org has no teams, the first project auto-creates one and the rest
    // reuse it. Pin that team slug up front so a real run and a --dry-run
    // preview agree (dry-run never actually creates the team). Search the
    // whole batch, not just parsed[0]: a name that slugifies to "" (e.g.
    // punctuation-only or non-ASCII) must not disable auto-create for every
    // other project in the batch — createOneProject's `??` fallback treats
    // "" as a set value, not a missing one.
    const teamAutoCreateSlug = parsed
      .map((p) => slugify(p.name))
      .find((slug) => slug !== "");
    const chooseTeam = flags.json ? undefined : createTeamChooser(this);

    // Create sequentially to respect rate limits. Results are emitted as one
    // value so --json stays parseable, including partial success before an error.
    const results: ProjectCreatedResult[] = [];
    let batchTeam: ResolvedConcreteTeam | undefined;
    try {
      for (const { name, platform } of parsed) {
        const result = await createOneProject({
          orgSlug,
          name,
          platform,
          flags,
          detectedFrom: resolved.detectedFrom,
          teamAutoCreateSlug,
          team: batchTeam,
          chooseTeam,
        });
        results.push(result);
        batchTeam = {
          slug: result.teamSlug,
          source: result.teamSource,
        };
      }
    } catch (error) {
      if (error instanceof ProjectTeamChoiceCancelledError) {
        log.info("Cancelled.");
        return;
      }
      if (results.length > 0) {
        yield new CommandOutput(
          buildProjectCreateOutput(results, parsed.length)
        );
      }
      throw error;
    }

    yield new CommandOutput(buildProjectCreateOutput(results, parsed.length));
  },
});
