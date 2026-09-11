import {
  getProject,
  resolveOrgDisplayName,
  tryGetPrimaryDsn,
} from "../api-client.js";
import { ApiError } from "../errors.js";
import { buildProjectUrl } from "../sentry-urls.js";
import type { ExistingProjectData } from "./types.js";

/**
 * Fetch Sentry metadata for an existing project.
 *
 * Returns `null` when the project does not exist, while allowing other API
 * errors to propagate so callers can decide whether the lookup is best-effort
 * or should fail the current operation.
 */
export async function tryGetExistingProjectData(
  orgSlug: string,
  projectSlug: string
): Promise<ExistingProjectData | null> {
  try {
    const project = await getProject(orgSlug, projectSlug);
    // The shared DSN resolver intentionally keeps cold SaaS lookups fast by
    // returning numeric IDs. Once init fetches the concrete project, switch to
    // the canonical organization slug returned by Sentry for display, URLs,
    // and every subsequent API call.
    const canonicalOrgSlug = project.organization?.slug ?? orgSlug;
    const dsn = await tryGetPrimaryDsn(canonicalOrgSlug, project.slug);
    return {
      orgSlug: canonicalOrgSlug,
      orgDisplay: resolveOrgDisplayName(
        canonicalOrgSlug,
        project.organization?.name
      ),
      projectSlug: project.slug,
      projectDisplay: project.name,
      projectId: project.id,
      url: buildProjectUrl(canonicalOrgSlug, project.slug),
      ...(dsn ? { dsn } : {}),
      ...(project.platform ? { platform: project.platform } : {}),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}
