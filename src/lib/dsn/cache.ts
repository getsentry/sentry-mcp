/**
 * DSN Cache
 *
 * Read/write DSN detection cache to global config.
 * Enables instant DSN verification on subsequent runs.
 *
 * Cache is stored in ~/.sentry-cli-next/config.json under dsnCache[directory]
 */

import { readConfig, writeConfig } from "../config.js";
import type { CachedDsnEntry, ResolvedProjectInfo } from "./types.js";

/**
 * Get cached DSN entry for a directory
 *
 * @param directory - Absolute path to the directory
 * @returns Cached entry or undefined if not cached
 */
export async function getCachedDsn(
  directory: string
): Promise<CachedDsnEntry | undefined> {
  const config = await readConfig();
  return config.dsnCache?.[directory];
}

/**
 * Set cached DSN entry for a directory
 *
 * @param directory - Absolute path to the directory
 * @param entry - DSN entry to cache (cachedAt will be added automatically)
 */
export async function setCachedDsn(
  directory: string,
  entry: Omit<CachedDsnEntry, "cachedAt">
): Promise<void> {
  const config = await readConfig();

  config.dsnCache = {
    ...config.dsnCache,
    [directory]: {
      ...entry,
      cachedAt: Date.now(),
    },
  };

  await writeConfig(config);
}

/**
 * Update resolved project info in cache
 *
 * Used after resolving DSN to org/project via API.
 * This allows skipping the API call on subsequent runs.
 *
 * @param directory - Absolute path to the directory
 * @param resolved - Resolved project information
 */
export async function updateCachedResolution(
  directory: string,
  resolved: ResolvedProjectInfo
): Promise<void> {
  const config = await readConfig();
  const existing = config.dsnCache?.[directory];

  if (!existing) {
    // No cache entry to update
    return;
  }

  config.dsnCache = {
    ...config.dsnCache,
    [directory]: {
      ...existing,
      resolved,
    },
  };

  await writeConfig(config);
}

/**
 * Clear DSN cache
 *
 * @param directory - If provided, clear only this directory. Otherwise clear all.
 */
export async function clearDsnCache(directory?: string): Promise<void> {
  const config = await readConfig();

  if (directory) {
    if (config.dsnCache?.[directory]) {
      delete config.dsnCache[directory];
    }
  } else {
    config.dsnCache = undefined;
  }

  await writeConfig(config);
}

/**
 * Check if cache entry is still valid
 *
 * Currently just checks if entry exists. Could be extended to
 * add TTL-based expiration if needed.
 *
 * @param entry - Cache entry to validate
 * @returns True if entry is valid
 */
export function isCacheValid(entry: CachedDsnEntry | undefined): boolean {
  if (!entry) {
    return false;
  }

  // For now, cache is always valid if it exists
  // The actual DSN verification happens in detector.ts by reading the source file

  // Could add TTL check here if needed:
  // const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
  // if (Date.now() - entry.cachedAt > MAX_AGE) {
  //   return false;
  // }

  return true;
}
