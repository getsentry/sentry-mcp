/**
 * Shared replay parameter resolution and constraint checks.
 *
 * Both replay tools accept either a replay URL or an organization plus replay
 * ID, and both must honour a session's project constraint. Keeping that in one
 * place means the two cannot disagree about what a valid replay reference is,
 * or about which replays a constrained session may read.
 */
import type { ReplayDetails, SentryApiService } from "../../api-client";
import { UserInputError } from "../../errors";
import { parseSentryUrl } from "../url-helpers";
import { resolveScopedOrganizationSlug } from "../url-scope";

export interface ResolvedReplayParams {
  organizationSlug: string;
  replayId: string;
}

export function resolveReplayParams(params: {
  replayUrl?: string | null;
  organizationSlug?: string | null;
  replayId?: string | null;
}): ResolvedReplayParams {
  if (params.replayUrl) {
    const parsed = parseSentryUrl(params.replayUrl);
    if (parsed.type !== "replay" || !parsed.replayId) {
      throw new UserInputError(
        "Invalid replay URL. URL must point to a Sentry replay resource.",
      );
    }
    return {
      organizationSlug: resolveScopedOrganizationSlug({
        resourceLabel: "Replay",
        scopedOrganizationSlug: params.organizationSlug,
        urlOrganizationSlug: parsed.organizationSlug,
      }),
      replayId: parsed.replayId,
    };
  }

  if (!params.organizationSlug || !params.replayId) {
    throw new UserInputError(
      "Provide either `replayUrl` or both `organizationSlug` and `replayId`.",
    );
  }

  return {
    organizationSlug: params.organizationSlug,
    replayId: params.replayId,
  };
}

/**
 * Reject a replay that falls outside the session's project constraint.
 *
 * A replay with no project cannot be shown to satisfy the constraint, so it is
 * rejected rather than assumed to be in scope.
 */
export async function assertReplayWithinProjectConstraint({
  apiService,
  organizationSlug,
  replay,
  projectSlug,
}: {
  apiService: SentryApiService;
  organizationSlug: string;
  replay: ReplayDetails;
  projectSlug?: string | null;
}): Promise<void> {
  if (!projectSlug) {
    return;
  }

  if (replay.project_id == null) {
    throw new UserInputError(
      `Replay is outside the active project constraint. Expected project "${projectSlug}".`,
    );
  }

  const project = await apiService.getProject({
    organizationSlug,
    projectSlugOrId: projectSlug,
  });

  if (String(project.id) !== String(replay.project_id)) {
    throw new UserInputError(
      `Replay is outside the active project constraint. Expected project "${projectSlug}".`,
    );
  }
}
