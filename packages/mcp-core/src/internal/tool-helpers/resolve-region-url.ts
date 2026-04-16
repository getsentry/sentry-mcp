import { apiServiceFromContext } from "./api";
import type { ServerContext } from "../../types";

/**
 * Resolves which regional Sentry API host to use for organization-scoped calls.
 * Uses the explicit `regionUrl` argument when set; otherwise fetches the
 * organization on the control-plane host. Hosted MCP and stdio hydrate
 * `constraints.regionUrl` from org metadata so it can be auto-injected like
 * `organizationSlug` when the session is org-scoped.
 */
export async function resolveRegionUrlForOrganization({
  context,
  organizationSlug,
  regionUrl,
}: {
  context: ServerContext;
  organizationSlug: string;
  regionUrl?: string | null;
}): Promise<string | null> {
  if (regionUrl != null) {
    const trimmed = regionUrl.trim();
    return trimmed || null;
  }

  try {
    const organization =
      await apiServiceFromContext(context).getOrganization(organizationSlug);
    return organization.links?.regionUrl?.trim() || null;
  } catch {
    return null;
  }
}
