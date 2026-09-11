/**
 * Sentry project creation tool for the init wizard.
 *
 * Implements the `create-sentry-project` and `ensure-sentry-project` wizard
 * operations. Resolves team capabilities only after the final project slug is
 * known, using the same policy as `sentry project create`.
 */

import { captureException } from "@sentry/node-core/light";
import { MEMBER_PROJECT_CREATION_DISABLED_DETAIL } from "../../api-client.js";
import { ApiError } from "../../errors.js";
import {
  createProjectWithTeamFallback,
  ProjectCreationApiError,
} from "../../project-creation.js";
import {
  type ResolvedConcreteTeam,
  resolveOrCreateTeam,
} from "../../resolve-team.js";
import { captureOAuthScopeRecoveryGate } from "../../scope-recovery.js";
import { slugify } from "../../utils.js";
import { WizardCancelledError } from "../clack-utils.js";
import { formatMemberProjectCreationDisabledError } from "../project-creation-errors.js";
import type {
  CreateSentryProjectPayload,
  EnsureSentryProjectPayload,
  ToolResult,
} from "../types.js";
import { formatToolError } from "./shared.js";
import type {
  InitToolDefinition,
  ProjectCreationToolContext,
} from "./types.js";

type ProjectData = {
  projectSlug: string;
  projectId: string;
  dsn: string;
  url: string;
};

function existingProjectResult(
  context: Pick<ProjectCreationToolContext, "existingProject" | "setupIntent">
): ToolResult | undefined {
  if (!context.existingProject) {
    return;
  }
  if (
    !context.existingProject.dsn &&
    context.setupIntent !== "improve-existing"
  ) {
    return {
      ok: false,
      error: `Could not obtain a DSN for existing project '${context.existingProject.orgSlug}/${context.existingProject.projectSlug}'. Check project-key access or choose a project whose keys you can read.`,
    };
  }
  return {
    ok: true,
    data: { ...context.existingProject, ensuredVia: "existing" },
  };
}

type ProjectCreationResponse = {
  project: {
    id: string;
    slug: string;
  };
  dsn?: string | null;
  url: string;
};

function toProjectData(response: ProjectCreationResponse): ProjectData {
  return {
    projectSlug: response.project.slug,
    projectId: response.project.id,
    dsn: response.dsn ?? "",
    url: response.url,
  };
}

/** Preserve user cancellation across the tool-result error boundary. */
function rethrowWizardCancellation(error: unknown): void {
  if (error instanceof WizardCancelledError) {
    throw error;
  }
}

/**
 * Retry a registry platform unknown to the projects API on the same concrete
 * route that rejected it. This avoids restarting team-to-organization routing.
 */
async function createProjectWithPlatformFallback(opts: {
  org: string;
  name: string;
  platform: string | null | undefined;
  team: ResolvedConcreteTeam | undefined;
}): Promise<ProjectData> {
  const { name, org, team } = opts;
  const platform = opts.platform ?? undefined;
  const create = async (
    selectedPlatform: string | undefined,
    selectedTeam: ResolvedConcreteTeam | undefined
  ) =>
    toProjectData(
      await createProjectWithTeamFallback({
        orgSlug: org,
        name,
        platform: selectedPlatform,
        team: selectedTeam,
      })
    );

  try {
    return await create(platform, team);
  } catch (error) {
    if (
      !(error instanceof ProjectCreationApiError) ||
      error.status !== 400 ||
      !platform ||
      !error.detail?.includes("Invalid platform")
    ) {
      throw error;
    }

    captureException(error.cause, {
      extra: {
        attemptedPlatform: platform,
        projectName: name,
        apiResponseDetail: error.detail,
        apiStatus: error.status,
      },
    });
    return await create(undefined, error.route === "team" ? team : undefined);
  }
}

/**
 * Create a new Sentry project using the org that preflight already resolved.
 * Team resolution happens here rather than in preflight so existing projects
 * never trigger a team prompt or API call, and a new team's slug can be based
 * on the final project name selected by the workflow.
 *
 * New Sentry orgs have member project creation disabled by default
 * (Organization.flags.disable_member_project_creation = true). When the org
 * restricts project creation for members, we surface a clear error with an
 * escape hatch: the user can pass `sentry init <org>/<project-slug>` once an
 * admin creates the project, which resolves to an existing project and skips
 * creation entirely (`resolveInitProjectContext` in preflight).
 */
export async function createSentryProject(
  payload: CreateSentryProjectPayload | EnsureSentryProjectPayload,
  context: Pick<
    ProjectCreationToolContext,
    | "dryRun"
    | "existingProject"
    | "org"
    | "team"
    | "project"
    | "setupIntent"
    | "chooseTeam"
  > & { yes?: boolean }
): Promise<ToolResult> {
  const name = context.project ?? payload.params.name;
  const slug = slugify(name);
  if (!slug) {
    return {
      ok: false,
      error: `Invalid project name: "${name}" produces an empty slug.`,
    };
  }

  const existing = existingProjectResult(context);
  if (existing) {
    return existing;
  }

  const scopeRecovery = captureOAuthScopeRecoveryGate();
  try {
    const team = await resolveOrCreateTeam(context.org, {
      team: context.team?.slug,
      autoCreateSlug: slug,
      usageHint: "sentry init",
      dryRun: context.dryRun,
      chooseTeam: context.chooseTeam,
    });

    if (context.dryRun) {
      return {
        ok: true,
        data: {
          orgSlug: context.org,
          projectSlug: slug,
          projectId: "(dry-run)",
          dsn: "https://key@o0.ingest.sentry.io/0",
          url: "https://sentry.io/dry-run",
        },
      };
    }

    const projectData = await createProjectWithPlatformFallback({
      org: context.org,
      name,
      platform: payload.params.platform,
      team,
    });

    return {
      ok: true,
      data: {
        orgSlug: context.org,
        projectSlug: projectData.projectSlug,
        projectId: projectData.projectId,
        dsn: projectData.dsn,
        url: projectData.url,
        ensuredVia: "created",
      },
    };
  } catch (error) {
    rethrowWizardCancellation(error);
    // Org-level policy: member project creation is disabled on this org.
    // Surface a clear message with the escape hatch.
    if (
      error instanceof ApiError &&
      error.status === 403 &&
      error.detail?.includes(MEMBER_PROJECT_CREATION_DISABLED_DETAIL)
    ) {
      return {
        ok: false,
        error: formatMemberProjectCreationDisabledError(context.org),
      };
    }
    if (
      await scopeRecovery.shouldDelegate(error, {
        unattended: context.yes === true || context.dryRun,
      })
    ) {
      throw error;
    }
    // 409: project already exists (from either the team-scoped or org-scoped
    // endpoint — both propagate here). Surface a friendly message with a view
    // hint rather than the raw API error text.
    if (error instanceof ApiError && error.status === 409) {
      return {
        ok: false,
        error:
          `A project named "${name}" already exists in "${context.org}".\n` +
          `View it: sentry project view ${context.org}/${slugify(name)}`,
      };
    }
    return { ok: false, error: formatToolError(error) };
  }
}

/**
 * Tool definition for creating or ensuring a Sentry project exists for init.
 */
const describeCreateSentryProject = (
  payload: CreateSentryProjectPayload | EnsureSentryProjectPayload
): string =>
  payload.detail ??
  `Ensuring project \`${payload.params.name}\` (${payload.params.platform})...`;

export const createSentryProjectTool: InitToolDefinition<"create-sentry-project"> =
  {
    operation: "create-sentry-project",
    describe: describeCreateSentryProject,
    execute: createSentryProject,
  };

export const ensureSentryProjectTool: InitToolDefinition<"ensure-sentry-project"> =
  {
    operation: "ensure-sentry-project",
    describe: describeCreateSentryProject,
    execute: createSentryProject,
  };
