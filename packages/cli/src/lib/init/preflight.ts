import type { SentryProject } from "../../types/index.js";
import { listOrganizations, listProjects } from "../api-client.js";
import { getAuthToken } from "../db/auth.js";
import { parseDsn } from "../dsn/index.js";
import { ApiError, AuthError, HostScopeError, WizardError } from "../errors.js";
import { logger } from "../logger.js";
import { resolveAllTargets } from "../resolve-target.js";
import { captureOAuthScopeRecoveryGate } from "../scope-recovery.js";
import { getSentryBaseUrl, isSentrySaasUrl } from "../sentry-urls.js";
import { slugify } from "../utils.js";
import { WizardCancelledError } from "./clack-utils.js";
import { tryGetExistingProjectData } from "./existing-project.js";
import { resolveOrgPrefetched } from "./org-prefetch.js";
import {
  detectSentrySetup,
  type ExistingSentryDetection,
} from "./tools/detect-sentry.js";
import type {
  ExistingProjectData,
  ResolvedInitContext,
  WizardOptions,
} from "./types.js";
import { isCancelled, type WizardUI } from "./ui/types.js";

const NUMERIC_ORG_ID_RE = /^\d+$/;
const log = logger.withTag("init-preflight");

type CanonicalProjectCandidate = {
  org: string;
  project: string;
  detectedDsn?: string;
};

type ProjectSelection = Pick<
  ResolvedInitContext,
  "project" | "existingProject" | "setupIntent"
> & {
  /** Canonical slug discovered while resolving a numeric DSN target. */
  org?: string;
};

function markExistingSetupForImprovement(
  selection: ProjectSelection,
  setup: ExistingSentryDetection
): ProjectSelection {
  return setup.status === "none"
    ? selection
    : { ...selection, setupIntent: "improve-existing" };
}

/**
 * Resolve organization and authentication before the remote workflow starts.
 * Project resolution is deliberately deferred until the workflow has selected
 * the concrete app in a monorepo.
 */
export async function resolveInitContext(
  initial: WizardOptions,
  ui: WizardUI
): Promise<ResolvedInitContext | null> {
  return await withPreflightHandling(ui, async () => {
    const codebaseCandidates = initial.org
      ? []
      : await resolveCanonicalProjects(initial.directory);
    const candidateOrgs = [
      ...new Set(codebaseCandidates.map((candidate) => candidate.org)),
    ];
    const inferredOrg =
      candidateOrgs.length === 1 ? candidateOrgs[0] : undefined;
    const preferredOrg =
      initial.org ??
      inferredOrg ??
      (await resolvePreferredOrg(initial.directory));
    const org = await ensureOrg(preferredOrg, initial, ui);

    const team = initial.team
      ? ({ slug: initial.team, source: "explicit" } as const)
      : undefined;

    return buildResolvedInitContext(initial, org, team);
  });
}

async function withPreflightHandling(
  ui: WizardUI,
  action: () => Promise<ResolvedInitContext | null>
): Promise<ResolvedInitContext | null> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof WizardCancelledError) {
      ui.cancel("Setup cancelled.");
      ui.feedback("cancelled");
      process.exitCode = 0;
      return null;
    }

    if (
      error instanceof AuthError ||
      error instanceof HostScopeError ||
      (error instanceof ApiError &&
        (error.status === 401 || error.status === 403))
    ) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    ui.log.error(message);
    ui.cancel("Setup failed.");
    ui.feedback("failed");
    throw error instanceof WizardError ? error : new WizardError(message);
  }
}

function buildResolvedInitContext(
  initial: WizardOptions,
  org: string,
  team: ResolvedInitContext["team"]
): ResolvedInitContext {
  return {
    directory: initial.directory,
    yes: initial.yes,
    dryRun: initial.dryRun,
    features: initial.features,
    org,
    team,
    project: initial.project,
    app: initial.app,
    authToken: getAuthToken(),
  };
}

/** Resolve organization-only context before project inference. */
async function resolvePreferredOrg(cwd: string): Promise<string | undefined> {
  const resolved = await resolveOrgPrefetched(cwd);
  return resolved && !NUMERIC_ORG_ID_RE.test(resolved.org)
    ? resolved.org
    : undefined;
}

async function ensureOrg(
  org: string | undefined,
  initial: WizardOptions,
  ui: WizardUI
): Promise<string> {
  if (org) {
    return org;
  }

  const orgResult = await resolveOrgSlug(initial.directory, initial.yes, ui);
  if (typeof orgResult === "string") {
    return orgResult;
  }

  throw new WizardError(orgResult.error ?? "Failed to resolve organization.");
}

/**
 * Resolve the Sentry project only after the workflow has selected its concrete
 * project directory. This lets monorepos use app-local DSNs, package files,
 * repository signals, and cwd inference instead of the workspace root.
 */
export async function resolveInitProjectContext(
  context: ResolvedInitContext,
  cwd: string,
  ui: WizardUI,
  options: {
    setup?: ExistingSentryDetection;
    suggestedProjectName?: string;
    supportsExistingSetupImprovement?: boolean;
  } = {}
): Promise<ProjectSelection> {
  const setup = options.setup ?? (await detectSentrySetup(cwd));

  if (context.project) {
    return await resolveExplicitProjectSelection(context, cwd, setup, options);
  }

  const canonicalSelection = await resolveCanonicalProjectSelection({
    context,
    cwd,
    options,
    setup,
    ui,
  });
  if (canonicalSelection) {
    return canonicalSelection;
  }

  return await resolveImplicitProjectSelection(context.org, context.yes, ui);
}

async function resolveExplicitProjectSelection(
  context: ResolvedInitContext,
  cwd: string,
  setup: ExistingSentryDetection,
  options: { supportsExistingSetupImprovement?: boolean }
): Promise<ProjectSelection> {
  const explicit = await resolveExistingProjectChoice({
    org: context.org,
    project: context.project ?? "",
    detectedDsn: setup.dsn,
  });
  if (!explicit.existingProject || setup.status === "none") {
    return explicit;
  }
  const matchesDetectedSetup = setup.dsn
    ? detectedSetupMatchesProject(setup, explicit.existingProject)
    : await canonicalProjectMatches(
        cwd,
        explicit.existingProject.orgSlug,
        explicit.existingProject.projectSlug
      );
  if (!matchesDetectedSetup) {
    return explicit;
  }
  assertImprovementSupported(setup, options);
  return markExistingSetupForImprovement(explicit, setup);
}

async function resolveCanonicalProjectSelection({
  context,
  cwd,
  options,
  setup,
  ui,
}: {
  context: ResolvedInitContext;
  cwd: string;
  options: {
    suggestedProjectName?: string;
    supportsExistingSetupImprovement?: boolean;
  };
  setup: ExistingSentryDetection;
  ui: WizardUI;
}): Promise<ProjectSelection | undefined> {
  const candidates = await resolveCanonicalProjects(cwd, context.org);
  const candidate = candidates.length === 1 ? candidates[0] : undefined;
  if (!candidate) {
    return;
  }
  const detected = await resolveExistingProjectChoice(candidate);
  if (!detected.existingProject) {
    return;
  }
  if (
    setup.status !== "none" &&
    setup.dsn &&
    !detectedSetupMatchesProject(setup, detected.existingProject)
  ) {
    return await resolveImplicitProjectSelection(context.org, context.yes, ui, {
      avoidProjectSlug: detected.existingProject.projectSlug,
      suggestedProjectName: options.suggestedProjectName,
    });
  }
  if (setup.status !== "none" && !(context.yes || context.dryRun)) {
    return await resolveDetectedSetupChoice(
      {
        context,
        detected,
        setup,
        suggestedProjectName: options.suggestedProjectName,
        supportsExistingSetupImprovement:
          options.supportsExistingSetupImprovement,
      },
      ui
    );
  }
  assertImprovementSupported(setup, options);
  return markExistingSetupForImprovement(detected, setup);
}

function detectedSetupMatchesProject(
  setup: ExistingSentryDetection,
  project: ExistingProjectData
): boolean {
  if (setup.status === "none" || !setup.dsn) {
    return false;
  }
  const parsed = parseDsn(setup.dsn);
  if (!parsed || parsed.projectId !== project.projectId) {
    return false;
  }
  const configuredOrigin = getSentryBaseUrl();
  if (isSentrySaasUrl(configuredOrigin)) {
    return parsed.orgId !== undefined;
  }
  return parsed.host === new URL(configuredOrigin).host;
}

async function canonicalProjectMatches(
  cwd: string,
  org: string,
  project: string
): Promise<boolean> {
  const candidates = await resolveCanonicalProjects(cwd, org);
  return (
    candidates.length === 1 &&
    candidates[0]?.org === org &&
    candidates[0]?.project === project
  );
}

function assertImprovementSupported(
  setup: ExistingSentryDetection,
  options: { supportsExistingSetupImprovement?: boolean }
): void {
  if (
    setup.status !== "none" &&
    options.supportsExistingSetupImprovement !== true
  ) {
    throw new WizardError(
      "This setup service version cannot safely improve an existing Sentry setup. Deploy or update the setup service before using this CLI version.",
      { rendered: false }
    );
  }
}

async function resolveCanonicalProjects(
  cwd: string,
  organizationFilter?: string
): Promise<CanonicalProjectCandidate[]> {
  // Auto-resolution is best-effort: only exact local evidence is safe enough to
  // reuse implicitly, and self-hosted targets belong to a different API origin.
  let resolved: Awaited<ReturnType<typeof resolveAllTargets>>;
  try {
    resolved = await resolveAllTargets({
      cwd,
      resolutionMode: "codebase",
      ...(organizationFilter ? { organizationFilter } : {}),
    });
  } catch (error) {
    log.debug("Could not auto-resolve an init project", error);
    return [];
  }

  if (resolved.skippedSelfHosted) {
    return [];
  }

  return resolved.targets
    .filter((target) => target.matchStrength !== "fuzzy")
    .map((target) => ({
      org: target.org,
      project: target.project,
      ...(target.detectedDsn ? { detectedDsn: target.detectedDsn.raw } : {}),
    }));
}

async function resolveExistingProjectChoice(opts: {
  org: string;
  project: string;
  detectedDsn?: string;
}): Promise<ProjectSelection> {
  const slug = slugify(opts.project);
  if (!slug) {
    return { project: opts.project };
  }

  const existingProject = await tryGetExistingProjectData(opts.org, slug);
  if (!existingProject) {
    return { project: opts.project };
  }

  const matchingDetectedDsn =
    opts.detectedDsn &&
    parseDsn(opts.detectedDsn)?.projectId === existingProject.projectId
      ? opts.detectedDsn
      : undefined;
  const resolvedDsn = existingProject.dsn ?? matchingDetectedDsn;

  return {
    org: existingProject.orgSlug,
    project: existingProject.projectSlug,
    existingProject: {
      ...existingProject,
      ...(resolvedDsn ? { dsn: resolvedDsn } : {}),
    },
  };
}

async function resolveDetectedSetupChoice(
  options: {
    context: ResolvedInitContext;
    detected: ProjectSelection;
    setup: ExistingSentryDetection;
    suggestedProjectName?: string;
    supportsExistingSetupImprovement?: boolean;
  },
  ui: WizardUI
): Promise<ProjectSelection> {
  const {
    context,
    detected,
    setup,
    suggestedProjectName,
    supportsExistingSetupImprovement,
  } = options;
  if (supportsExistingSetupImprovement === false) {
    ui.log.warn(
      "The current setup service cannot safely improve this existing Sentry setup. Choose another project or create a new one."
    );
    return await resolveImplicitProjectSelection(context.org, false, ui, {
      avoidProjectSlug:
        detected.existingProject?.projectSlug ?? detected.project,
      suggestedProjectName,
    });
  }
  const project = detected.existingProject;
  const setupContext = project
    ? `Sentry detected for project ${project.projectDisplay ?? project.projectSlug} in organization ${project.orgDisplay ?? project.orgSlug}. What would you like to do?`
    : "What would you like to do with this Sentry setup?";
  const intent = await ui.select<"improve" | "other">({
    message: setupContext,
    options: [
      {
        value: "improve",
        label: "Improve your Sentry setup",
        description: "Upgrade your current setup and add more Sentry features.",
      },
      {
        value: "other",
        label: "Use or create another Sentry project",
        description: "Use another project or create a new one.",
      },
    ],
    initialValue: "improve",
  });
  if (isCancelled(intent)) {
    throw new WizardCancelledError();
  }
  if (intent === "improve") {
    assertImprovementSupported(setup, { supportsExistingSetupImprovement });
    return { ...detected, setupIntent: "improve-existing" };
  }
  return await resolveImplicitProjectSelection(context.org, false, ui, {
    avoidProjectSlug: detected.existingProject?.projectSlug ?? detected.project,
    suggestedProjectName,
  });
}

/**
 * Resolve new-project creation versus an existing project after the shared
 * resolver found no unique target. Creation is the default and selecting an
 * existing project is a separate, deliberate action.
 */
async function resolveImplicitProjectSelection(
  org: string,
  yes: boolean,
  ui: WizardUI,
  options: {
    avoidProjectSlug?: string;
    suggestedProjectName?: string;
  } = {}
): Promise<ProjectSelection> {
  if (yes) {
    return options.avoidProjectSlug
      ? await resolveAlternativeProjectSelection(
          org,
          options.avoidProjectSlug,
          options.suggestedProjectName
        )
      : { project: undefined, existingProject: undefined };
  }

  const intent = await ui.select<"create" | "existing">({
    message: "How should Sentry be configured for this codebase?",
    options: [
      {
        value: "create",
        label: "+ Create a new Sentry project",
      },
      {
        value: "existing",
        label: "Use an existing Sentry project",
      },
    ],
  });
  if (isCancelled(intent)) {
    throw new WizardCancelledError();
  }
  if (intent === "create") {
    if (options.avoidProjectSlug) {
      const selection = await resolveAlternativeProjectSelection(
        org,
        options.avoidProjectSlug,
        options.suggestedProjectName
      );
      const { project } = selection;
      ui.log.info(`New project ${project} in organization ${org}`);
      return selection;
    }
    return { project: undefined, existingProject: undefined };
  }

  return await resolveExistingProjectSelection(
    org,
    ui,
    options.avoidProjectSlug
  );
}

async function resolveExistingProjectSelection(
  org: string,
  ui: WizardUI,
  avoidProjectSlug?: string
): Promise<ProjectSelection> {
  let projects: SentryProject[];
  try {
    projects = await listProjects(org);
  } catch (error) {
    const reason = error instanceof ApiError ? error.format() : String(error);
    throw new WizardError(
      `Could not list existing projects in '${org}'.\n\n${reason}`
    );
  }
  if (avoidProjectSlug) {
    const avoided = slugify(avoidProjectSlug);
    projects = projects.filter((project) => project.slug !== avoided);
  }
  if (projects.length === 0) {
    throw new WizardError(
      `There are no${avoidProjectSlug ? " other" : ""} existing projects in '${org}'. Choose "+ Create a new Sentry project" instead.`
    );
  }

  const projectSlug = await ui.select<string>({
    message: "Which existing Sentry project should be used?",
    options: projects.map((project) => ({
      value: project.slug,
      label: project.name,
      ...(project.name !== project.slug ? { hint: project.slug } : {}),
    })),
  });
  if (isCancelled(projectSlug)) {
    throw new WizardCancelledError();
  }

  const existingProject = await loadExistingProject(
    org,
    projectSlug,
    "your project selection"
  );
  if (!existingProject) {
    throw new WizardError(
      `Project '${org}/${projectSlug}' is no longer available. Run sentry init again to refresh the project list.`
    );
  }
  return {
    org: existingProject.orgSlug,
    project: existingProject.projectSlug,
    existingProject,
  };
}

async function resolveAlternativeProjectSelection(
  org: string,
  avoidProjectSlug: string,
  suggestedProjectName?: string
): Promise<ProjectSelection> {
  const project = await findAvailableProjectSlug(
    org,
    suggestedProjectName ?? avoidProjectSlug,
    avoidProjectSlug
  );
  return { project, existingProject: undefined };
}

async function findAvailableProjectSlug(
  org: string,
  suggestedProjectName: string,
  avoidedProjectSlug: string
): Promise<string> {
  const base = slugify(suggestedProjectName) || "sentry-project";
  const avoided = slugify(avoidedProjectSlug);

  if (base !== avoided && !(await tryGetExistingProjectData(org, base))) {
    return base;
  }

  for (let suffix = 2; suffix <= 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!(await tryGetExistingProjectData(org, candidate))) {
      return candidate;
    }
  }

  throw new WizardError(
    `Could not find an available project slug based on '${base}'. Choose an existing Sentry project instead.`
  );
}

async function loadExistingProject(
  org: string,
  project: string,
  detectedFrom: string
): Promise<ExistingProjectData | null> {
  try {
    return await tryGetExistingProjectData(org, project);
  } catch (error) {
    const reason = error instanceof ApiError ? error.format() : String(error);
    throw new WizardError(
      `Found existing project '${org}/${project}' from ${detectedFrom}, but could not load its DSN.\n\n${reason}`
    );
  }
}

/**
 * Format a 403/401 ApiError from listOrganizations() into a { ok: false }
 * result, or re-throw if the error is something else.
 *
 * 403: token lacks org:read scope — user can bypass by supplying the org slug
 * directly. 401: token is invalid/expired — supplying an org won't help, only
 * re-authenticating will.
 */
function handleOrgListError(error: unknown): { ok: false; error: string } {
  if (error instanceof ApiError && error.status === 403) {
    const lines: string[] = ["Could not list organizations (403 Forbidden)."];
    if (error.detail) {
      lines.push(error.detail, "");
    }
    lines.push(
      "Specify the org on the command line:  sentry init <org-slug>/",
      "Or set an environment variable:       SENTRY_ORG=<org-slug> sentry init"
    );
    return { ok: false, error: lines.join("\n  ") };
  }
  if (error instanceof ApiError && error.status === 401) {
    const lines: string[] = [
      "Could not list organizations (401 Unauthorized).",
    ];
    if (error.detail) {
      lines.push(error.detail);
    }
    return { ok: false, error: lines.join("\n  ") };
  }
  throw error;
}

async function resolveOrgSlug(
  cwd: string,
  yes: boolean,
  ui: WizardUI
): Promise<string | { ok: false; error: string }> {
  const resolved = await resolveOrgPrefetched(cwd);
  if (resolved && !NUMERIC_ORG_ID_RE.test(resolved.org)) {
    return resolved.org;
  }

  let orgs: Awaited<ReturnType<typeof listOrganizations>>;
  const scopeRecovery = captureOAuthScopeRecoveryGate();
  try {
    orgs = await listOrganizations();
  } catch (error) {
    if (await scopeRecovery.shouldDelegate(error, { unattended: yes })) {
      throw error;
    }
    return handleOrgListError(error);
  }
  orgs.sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.slug.localeCompare(right.slug)
  );
  if (orgs.length === 0) {
    return {
      ok: false,
      error: "Not authenticated. Run 'sentry auth login' first.",
    };
  }
  if (orgs.length === 1 && orgs[0]) {
    return orgs[0].slug;
  }

  if (yes) {
    const slugs = orgs.map((org) => org.slug).join(", ");
    return {
      ok: false,
      error: [
        `Multiple organizations found (${slugs}).`,
        "Specify one with: sentry init <org-slug>/ [directory]",
        "  or set SENTRY_ORG=<org-slug>",
      ].join("\n"),
    };
  }

  const selected = await ui.select<string>({
    message: "Which organization should Sentry use?",
    options: orgs.map((org) => ({
      value: org.slug,
      label: org.name,
      hint: org.slug,
    })),
  });
  if (isCancelled(selected)) {
    throw new WizardCancelledError();
  }
  return selected;
}
