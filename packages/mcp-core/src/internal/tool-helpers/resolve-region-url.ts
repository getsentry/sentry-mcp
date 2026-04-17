import { apiServiceFromContext } from "./api";
import type { ServerContext } from "../../types";

const regionUrlCache = new WeakMap<ServerContext, Map<string, string | null>>();

function getRegionUrlCache(context: ServerContext): Map<string, string | null> {
  let cache = regionUrlCache.get(context);

  if (!cache) {
    cache = new Map<string, string | null>();
    regionUrlCache.set(context, cache);
  }

  return cache;
}

/**
 * Resolves which regional Sentry API host to use for organization-scoped calls.
 * Uses the explicit `regionUrl` argument when set; otherwise prefers the
 * scoped value already present on `context.constraints`, then lazily fetches
 * and caches the org metadata for repeated lookups within the same context.
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
  if (typeof regionUrl === "string") {
    const trimmed = regionUrl.trim();
    return trimmed || null;
  }

  if (context.constraints.organizationSlug === organizationSlug) {
    const scopedRegionUrl = context.constraints.regionUrl?.trim();
    if (scopedRegionUrl) {
      return scopedRegionUrl;
    }
  }

  const normalizedOrganizationSlug = organizationSlug.trim();
  const cache = getRegionUrlCache(context);
  if (cache.has(normalizedOrganizationSlug)) {
    return cache.get(normalizedOrganizationSlug) ?? null;
  }

  try {
    const organization = await apiServiceFromContext(context).getOrganization(
      normalizedOrganizationSlug,
    );
    const resolvedRegionUrl = organization.links?.regionUrl?.trim() || null;
    cache.set(normalizedOrganizationSlug, resolvedRegionUrl);
    return resolvedRegionUrl;
  } catch {
    return null;
  }
}
