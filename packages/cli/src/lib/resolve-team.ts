/**
 * Team Resolution
 *
 * Resolves which team to use for project creation.
 * Shared by `sentry project create` and `sentry init`.
 *
 * ## Resolution flow
 *
 * 1. Explicit `--team` flag → use as-is, no validation
 * 2. Fetch org teams via `listTeams`
 *    - On 404: org doesn't exist → resolve effective org via cache, show org list
 *    - On other errors: surface status + generic hint
 * 3. Filter to teams on which the caller has effective `team:admin` access.
 *    - One eligible team is the non-interactive default.
 *    - Interactive callers offer create-new first, then existing-team choice.
 *    - Multiple eligible teams require an interactive choice or `--team`.
 * 4. If the user chooses create-new or no eligible team exists, inspect the
 *    organization policy. When member project creation is allowed or the
 *    caller has `org:write`, return no team so the org-scoped onboarding
 *    endpoint can atomically create the project and its personal Team Admin
 *    team.
 * 5. For a restricted organization, create a new project-owning team only when
 *    the caller has both `project:admin` and `team:admin`. The latter is needed
 *    to administer the team after creating it and create its project.
 *
 * The resolver owns capability and fallback policy. Callers own presentation
 * through the narrow `chooseTeam` callback so Ink and plain CLI prompts can
 * share the same decision flow without leaking UI dependencies here.
 */

import type { SentryTeam } from "../types/index.js";
import {
  createTeam,
  getOrganization,
  listOrganizations,
  listTeams,
} from "./api-client.js";
import {
  ApiError,
  AuthError,
  CliError,
  ContextError,
  ResolutionError,
} from "./errors.js";
import { logger } from "./logger.js";
import { resolveEffectiveOrg } from "./region.js";
import type { ProjectTeamChoice, ProjectTeamOption } from "./team-choice.js";

/**
 * Best-effort fetch the user's organizations and format as a hint string.
 * Returns a fallback hint if the API call fails or no orgs are found.
 *
 * @param fallbackHint - Shown when the org list can't be fetched
 * @returns Formatted org list like "Your organizations:\n\n  acme-corp\n  other-org"
 */
async function fetchOrgListHint(fallbackHint: string): Promise<string> {
  // biome-ignore lint/plugin: grandfathered silent catch — see #1531; drain by adding log.debug()/log.warn() or re-throwing.
  try {
    const orgs = await listOrganizations();
    if (orgs.length > 0) {
      const orgList = orgs.map((o) => `  ${o.slug}`).join("\n");
      return `Your organizations:\n\n${orgList}`;
    }
  } catch {
    // Best-effort — if this also fails, use the fallback
  }
  return fallbackHint;
}

/** Options for resolving a team within an organization */
export type ChooseProjectTeam = (
  teams: readonly ProjectTeamOption[]
) => Promise<ProjectTeamChoice>;

export type ResolveTeamOptions = {
  /** Explicit team slug from --team flag */
  team?: string;
  /** Source of the auto-detected org, shown in error messages */
  detectedFrom?: string;
  /** Usage hint shown in errors (e.g., "sentry project create <org>/<name>:<platform>") */
  usageHint: string;
  /** Slug to use when auto-creating a team for a project admin. */
  autoCreateSlug?: string;
  /**
   * When true, skip the actual team creation API call and return what
   * would be created. The returned ResolvedTeam has source "auto-created"
   * with the autoCreateSlug value.
   */
  dryRun?: boolean;
  /** Ask an interactive user whether to create or select an eligible team. */
  chooseTeam?: ChooseProjectTeam;
};

/** Result of team resolution that produced a concrete team slug. */
export type ResolvedConcreteTeam = {
  /** The resolved team slug */
  slug: string;
  /** How the team was determined */
  source: "explicit" | "selected" | "auto-selected" | "auto-created";
};

/**
 * Build the actionable authorization error used when account permissions and
 * token scopes disagree. This commonly happens to OAuth sessions issued before
 * `team:admin` became part of the CLI's standard scope set. Keeping the scope
 * name in an `ApiError` detail lets the global scope-recovery middleware offer
 * a one-time OAuth refresh and retry the command for those existing grants.
 */
export function buildTeamAdminAuthorizationError(
  orgSlug: string,
  teamSlug?: string
): ApiError {
  const target = teamSlug ? `team '${teamSlug}'` : "a new project-owning team";
  return new ApiError(
    `Cannot create the project through ${target} in '${orgSlug}' without the 'team:admin' authorization scope.`,
    403,
    [
      "This operation requires the 'team:admin' authorization scope.",
      "Your Sentry role may already grant Team Admin access, but the current CLI authorization may predate that standard scope.",
      "Re-authorize the CLI, or use an auth token with team:admin.",
    ].join("\n")
  );
}

/**
 * Handle errors from `listTeams` during team resolution.
 *
 * - 404 → org not found (builds a rich error with org list)
 * - 403 is handled by the caller as an org-scoped creation fallback.
 * - 401 → re-thrown as `ApiError` so the enriched detail (expired session,
 *   member-disabled-over-limit, etc.) survives instead of being flattened.
 * - other → generic ResolutionError (5xx, network, etc.)
 */
async function handleListTeamsError(
  error: unknown,
  orgSlug: string,
  options: ResolveTeamOptions
): Promise<never> {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return await buildOrgNotFoundError(
        orgSlug,
        options.usageHint,
        options.detectedFrom
      );
    }
    if (error.status === 403) {
      throw error;
    }
    if (error.status === 401) {
      throw error;
    }
    throw new ResolutionError(
      `Organization '${orgSlug}'`,
      `could not be accessed (${error.status})`,
      `${options.usageHint} --team <team-slug>`,
      ["The organization may not exist, or you may lack access"]
    );
  }
  throw error;
}

/**
 * List visible teams. A 403 is not fatal: the organization-scoped onboarding
 * route may still be available without permission to enumerate teams.
 */
async function listTeamsForResolution(
  orgSlug: string,
  options: ResolveTeamOptions
): Promise<SentryTeam[] | undefined> {
  try {
    return await listTeams(orgSlug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return;
    }
    return await handleListTeamsError(error, orgSlug, options);
  }
}

type EligibleTeamDecision =
  | { kind: "create" }
  | { kind: "team"; team: ResolvedConcreteTeam };

/** Resolve the existing-team side of the policy without creating anything. */
async function resolveEligibleTeam(
  orgSlug: string,
  teams: readonly SentryTeam[],
  options: ResolveTeamOptions
): Promise<EligibleTeamDecision> {
  const eligibleTeams = teams.filter(
    (team) => Array.isArray(team.access) && team.access.includes("team:admin")
  );

  if (eligibleTeams.length === 0) {
    return { kind: "create" };
  }

  if (options.chooseTeam) {
    const eligibleBySlug = new Map(
      eligibleTeams.map((team) => [team.slug, team] as const)
    );
    const choice = await options.chooseTeam(
      eligibleTeams.map(({ slug, name }) => ({ slug, name }))
    );
    if (choice.kind === "create") {
      return choice;
    }
    const selected = eligibleBySlug.get(choice.slug);
    if (!selected) {
      throw new CliError(
        `Selected team '${choice.slug}' is not an eligible Team Admin team in '${orgSlug}'.`
      );
    }
    return {
      kind: "team",
      team: { slug: selected.slug, source: "selected" },
    };
  }

  const [onlyTeam] = eligibleTeams;
  if (eligibleTeams.length === 1 && onlyTeam) {
    return {
      kind: "team",
      team: { slug: onlyTeam.slug, source: "auto-selected" },
    };
  }

  const shown = eligibleTeams.slice(0, 10);
  const remaining = eligibleTeams.length - shown.length;
  throw new ContextError("Team", `${options.usageHint} --team <team-slug>`, [
    `You are a Team Admin of ${eligibleTeams.length} teams in '${orgSlug}'. Choose one explicitly with --team.`,
    ...shown.map((team) => `Available: ${team.slug}`),
    ...(remaining > 0 ? [`...and ${remaining} more`] : []),
  ]);
}

/** Resolve the create-new path after existing-team selection is exhausted. */
async function resolveNewTeam(
  orgSlug: string,
  options: ResolveTeamOptions
): Promise<ResolvedConcreteTeam | undefined> {
  if (!options.autoCreateSlug) {
    return;
  }

  let organization: Awaited<ReturnType<typeof getOrganization>>;
  try {
    organization = await getOrganization(orgSlug);
  } catch (error) {
    // Team listing already proved the org exists. If its detail endpoint is
    // unavailable, let the org-scoped project endpoint produce the precise
    // creation error instead of turning a best-effort capability check into a
    // blocker.
    logger.debug(
      "Could not inspect organization project-creation policy",
      error
    );
    return;
  }

  const access = Array.isArray(organization.access) ? organization.access : [];
  if (
    organization.allowMemberProjectCreation !== false ||
    access.includes("org:write")
  ) {
    return;
  }
  if (!access.includes("project:admin")) {
    return;
  }
  if (!access.includes("team:admin")) {
    throw buildTeamAdminAuthorizationError(orgSlug);
  }
  if (options.dryRun) {
    return { slug: options.autoCreateSlug, source: "auto-created" };
  }
  return await autoCreateTeam(orgSlug, options.autoCreateSlug);
}

/**
 * Resolve which team to use for project creation.
 *
 * @param orgSlug - Organization to list teams from
 * @param options - Resolution options (team flag, usage hint, detection source)
 * @returns Resolved team slug with source info, or undefined for the
 *   org-scoped onboarding route
 * @throws {ResolutionError} When org slug returns 404
 */
export async function resolveOrCreateTeam(
  orgSlug: string,
  options: ResolveTeamOptions
): Promise<ResolvedConcreteTeam | undefined> {
  if (options.team) {
    return { slug: options.team, source: "explicit" };
  }

  const teams = await listTeamsForResolution(orgSlug, options);
  if (!teams) {
    return;
  }

  const decision = await resolveEligibleTeam(orgSlug, teams, options);
  if (decision.kind === "team") {
    return decision.team;
  }
  return await resolveNewTeam(orgSlug, options);
}

/**
 * Auto-create a project-owning team, retrying deterministic suffixes when a
 * non-admin team already owns the preferred slug.
 */
async function autoCreateTeam(
  orgSlug: string,
  slug: string
): Promise<ResolvedConcreteTeam> {
  const candidates = [
    slug,
    `${slug}-team`,
    ...[2, 3, 4].map((n) => `${slug}-team-${n}`),
  ];

  for (const candidate of candidates) {
    const result = await tryCreateTeamCandidate(orgSlug, candidate, slug);
    if (result === "conflict") {
      continue;
    }
    return result;
  }

  throw new CliError(
    `Could not create a unique team for project '${slug}' in '${orgSlug}'.`
  );
}

/**
 * Attempt one candidate slug. A conflict asks the outer bounded retry loop for
 * another slug; a permission failure reports the stale authorization without
 * mutating further.
 */
async function tryCreateTeamCandidate(
  orgSlug: string,
  candidate: string,
  projectSlug: string
): Promise<ResolvedConcreteTeam | "conflict"> {
  try {
    const team = await createTeam(orgSlug, candidate);
    return { slug: team.slug, source: "auto-created" };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    if (error instanceof ApiError && error.status === 403) {
      throw buildTeamAdminAuthorizationError(orgSlug, candidate);
    }
    if (error instanceof ApiError && error.status === 409) {
      return "conflict";
    }
    throw new CliError(
      `Could not create a team for project '${projectSlug}' in '${orgSlug}'.` +
        (error instanceof ApiError
          ? `\n\nAPI error (${error.status}): ${error.detail ?? error.message}`
          : "")
    );
  }
}

/**
 * Build an error for when an org slug is not found (404).
 * Uses resolveEffectiveOrg for offline validation of DSN org prefixes,
 * then best-effort fetches the user's actual organizations to help them fix it.
 *
 * @param orgSlug - The org slug that was not found
 * @param usageHint - Usage example shown in error message
 * @param detectedFrom - Where the org was auto-detected from, if applicable
 */
export async function buildOrgNotFoundError(
  orgSlug: string,
  usageHint: string,
  detectedFrom?: string
): Promise<never> {
  // Try resolving DSN-style org IDs (e.g., o1081365 → actual slug)
  const effectiveOrg = await resolveEffectiveOrg(orgSlug);
  if (effectiveOrg !== orgSlug) {
    throw new ResolutionError(
      `Organization '${orgSlug}'`,
      `not found (did you mean '${effectiveOrg}'?)`,
      usageHint,
      [`Try using '${effectiveOrg}' as the org slug instead of '${orgSlug}'`]
    );
  }

  const orgHint = await fetchOrgListHint(
    `Specify org explicitly: ${usageHint}`
  );

  const suggestions: string[] = [];
  if (detectedFrom) {
    suggestions.push(`Org '${orgSlug}' was auto-detected from ${detectedFrom}`);
  }
  suggestions.push(orgHint);

  throw new ResolutionError(
    `Organization '${orgSlug}'`,
    "not found",
    usageHint,
    suggestions
  );
}
