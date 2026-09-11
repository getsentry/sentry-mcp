/**
 * Shared project-creation routing for CLI commands.
 *
 * A resolved team uses the team-scoped endpoint. When an implicitly resolved
 * team rejects creation, the org-scoped onboarding endpoint can create a
 * personal team instead. Explicit or interactively selected teams and org
 * policy failures never fall back, preserving the user's choice and the
 * organization's restriction.
 */

import {
  type CreatedProjectDetails,
  createProjectWithAutoTeam,
  createProjectWithDsn,
  MEMBER_PROJECT_CREATION_DISABLED_DETAIL,
} from "./api-client.js";
import { ApiError } from "./errors.js";
import {
  buildTeamAdminAuthorizationError,
  type ResolvedConcreteTeam,
} from "./resolve-team.js";

/** Project details plus the owning team selected by the creation route. */
export type ProjectCreationResult = CreatedProjectDetails & {
  /** Slug of the existing or newly created team that owns the project. */
  teamSlug: string;
  /** How the owning team was selected. */
  teamSource: ResolvedConcreteTeam["source"];
};

/** Inputs for shared project-creation endpoint selection. */
export type ProjectCreationOptions = {
  /** Project display name. */
  name: string;
  /** Organization that will own the project. */
  orgSlug: string;
  /** Optional Sentry platform identifier. */
  platform?: string;
  /** Resolved team, or undefined to use org-scoped onboarding creation. */
  team?: ResolvedConcreteTeam;
};

/** API route selected by the shared project-creation resolver. */
export type ProjectCreationRoute = "organization" | "team";

/** ApiError annotated with the concrete project-creation route that failed. */
export class ProjectCreationApiError extends ApiError {
  /** Original API error before route annotation. */
  override readonly cause: ApiError;
  /** Concrete endpoint family that produced the error. */
  readonly route: ProjectCreationRoute;

  /**
   * @param cause - Original API error
   * @param route - Project-creation route that failed
   */
  constructor(cause: ApiError, route: ProjectCreationRoute) {
    super(
      cause.message,
      cause.status,
      cause.detail,
      cause.endpoint,
      cause.enriched403
    );
    this.name = "ProjectCreationApiError";
    this.cause = cause;
    this.route = route;
  }
}

/**
 * Execute one concrete creation route and retain that provenance on API errors.
 * The caller can use the route tag without inferring it from mutable resolver state.
 */
async function createOnRoute(
  requestedPlatform: string | undefined,
  route: ProjectCreationRoute,
  create: (
    selectedPlatform: string | undefined
  ) => Promise<ProjectCreationResult>
): Promise<ProjectCreationResult> {
  try {
    return await create(requestedPlatform);
  } catch (error) {
    if (error instanceof ApiError) {
      throw new ProjectCreationApiError(error, route);
    }
    throw error;
  }
}

/** Match the policy detail shared by both project-creation endpoints. */
function isMemberCreationDisabled403(
  error: unknown
): error is ProjectCreationApiError {
  return (
    error instanceof ProjectCreationApiError &&
    error.status === 403 &&
    error.detail?.includes(MEMBER_PROJECT_CREATION_DISABLED_DETAIL) === true
  );
}

/** Whether team choice must be preserved instead of using a personal team. */
function isUserSelectedTeam(team: ResolvedConcreteTeam): boolean {
  return team.source === "explicit" || team.source === "selected";
}

/**
 * Create a project through the same endpoint-selection policy used by the UI.
 */
export async function createProjectWithTeamFallback(
  options: ProjectCreationOptions
): Promise<ProjectCreationResult> {
  const { name, orgSlug, platform, team } = options;

  if (!team) {
    return await createOnRoute(
      platform,
      "organization",
      async (selectedPlatform) => {
        const result = await createProjectWithAutoTeam(orgSlug, {
          name,
          platform: selectedPlatform,
        });
        return {
          project: result.project,
          dsn: result.dsn,
          url: result.url,
          teamSlug: result.team_slug,
          teamSource: "auto-created",
        };
      }
    );
  }

  try {
    return await createOnRoute(platform, "team", async (selectedPlatform) => {
      const result = await createProjectWithDsn(orgSlug, team.slug, {
        name,
        platform: selectedPlatform,
      });
      return {
        ...result,
        teamSlug: team.slug,
        teamSource: team.source,
      };
    });
  } catch (error) {
    if (!(error instanceof ProjectCreationApiError && error.status === 403)) {
      throw error;
    }

    // TeamProjectsEndpoint uses the member-creation-disabled detail when its
    // `has_team_scope(team, "team:admin")` check fails. Since this team was
    // selected from serialized Team Admin access, that response means the
    // token's OAuth upper bound is stale, not that another route can work.
    if (team.source !== "explicit" && isMemberCreationDisabled403(error)) {
      throw buildTeamAdminAuthorizationError(orgSlug, team.slug);
    }

    // A user-selected team is authoritative just like --team: never replace
    // it with a personal team through the organization route.
    if (isUserSelectedTeam(team)) {
      throw error;
    }

    // Unlike TeamProjectsEndpoint, the organization-scoped endpoint's policy
    // detail is authoritative. Preserve its route and detail so callers show
    // the policy recovery, not a useless OAuth team:admin refresh.
    return await createOnRoute(
      platform,
      "organization",
      async (selectedPlatform) => {
        const result = await createProjectWithAutoTeam(orgSlug, {
          name,
          platform: selectedPlatform,
        });
        return {
          project: result.project,
          dsn: result.dsn,
          url: result.url,
          teamSlug: result.team_slug,
          teamSource: "auto-created",
        };
      }
    );
  }
}
