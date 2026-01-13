/**
 * Configuration Management
 *
 * Handles reading/writing the ~/.sentry-cli-next/config.json file.
 * Uses Bun file APIs for I/O and Zod for validation.
 *
 * Permissions follow SSH conventions for sensitive files.
 * @see https://superuser.com/a/215506/26230
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CachedProject, SentryConfig } from "../types/index.js";
import { SentryConfigSchema } from "../types/index.js";

const CONFIG_DIR = join(homedir(), ".sentry-cli-next");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Ensure the config directory exists
 *
 * Permissions:
 * - Directory: 700 (drwx------)
 * - Config file: 600 (-rw-------)
 *
 * Using node:fs for directory creation to support explicit permissions.
 * mkdirSync with recursive: true is idempotent - it won't fail if dir exists.
 */
function ensureConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

/**
 * Read the configuration file with Zod validation
 */
export async function readConfig(): Promise<SentryConfig> {
  try {
    const file = Bun.file(CONFIG_FILE);
    if (!(await file.exists())) {
      return {};
    }
    const content = await file.json();
    // Validate with Zod, using safeParse to avoid throwing on invalid config
    const result = SentryConfigSchema.safeParse(content);
    if (result.success) {
      return result.data;
    }
    // If validation fails, return empty config (don't crash on corrupted file)
    console.error("Warning: Config file has invalid format, using defaults");
    return {};
  } catch {
    return {};
  }
}

/**
 * Write the configuration file
 *
 * Note: Bun.write doesn't support mode option, but the directory
 * permissions (700) provide adequate protection for the config file.
 */
export async function writeConfig(config: SentryConfig): Promise<void> {
  ensureConfigDir();
  await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Update specific fields in the configuration
 */
export async function updateConfig(
  updates: Partial<SentryConfig>
): Promise<SentryConfig> {
  const config = await readConfig();
  const newConfig = { ...config, ...updates };
  await writeConfig(newConfig);
  return newConfig;
}

/**
 * Get the stored authentication token
 */
export async function getAuthToken(): Promise<string | undefined> {
  const config = await readConfig();

  // Check if token has expired
  if (config.auth?.expiresAt && Date.now() > config.auth.expiresAt) {
    return;
  }

  return config.auth?.token;
}

/**
 * Store authentication credentials
 */
export async function setAuthToken(
  token: string,
  expiresIn?: number,
  refreshToken?: string
): Promise<void> {
  const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined;

  await updateConfig({
    auth: {
      token,
      refreshToken,
      expiresAt,
    },
  });
}

/**
 * Clear authentication credentials
 */
export async function clearAuth(): Promise<void> {
  const config = await readConfig();
  config.auth = undefined;
  await writeConfig(config);
}

/**
 * Get default organization
 */
export async function getDefaultOrganization(): Promise<string | undefined> {
  const config = await readConfig();
  return config.defaults?.organization;
}

/**
 * Get default project
 */
export async function getDefaultProject(): Promise<string | undefined> {
  const config = await readConfig();
  return config.defaults?.project;
}

/**
 * Set default organization and/or project
 */
export async function setDefaults(
  organization?: string,
  project?: string
): Promise<void> {
  const config = await readConfig();
  config.defaults = {
    ...config.defaults,
    ...(organization && { organization }),
    ...(project && { project }),
  };
  await writeConfig(config);
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const token = await getAuthToken();
  return !!token;
}

/**
 * Get the config file path (for display purposes)
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate cache key for a project
 */
function projectCacheKey(orgId: string, projectId: string): string {
  return `${orgId}:${projectId}`;
}

/**
 * Get cached project information
 *
 * @param orgId - Organization ID (numeric)
 * @param projectId - Project ID (numeric)
 * @returns Cached project info or undefined if not cached
 */
export async function getCachedProject(
  orgId: string,
  projectId: string
): Promise<CachedProject | undefined> {
  const config = await readConfig();
  const key = projectCacheKey(orgId, projectId);
  return config.projectCache?.[key];
}

/**
 * Cache project information
 *
 * @param orgId - Organization ID (numeric)
 * @param projectId - Project ID (numeric)
 * @param info - Project information to cache
 */
export async function setCachedProject(
  orgId: string,
  projectId: string,
  info: Omit<CachedProject, "cachedAt">
): Promise<void> {
  const config = await readConfig();
  const key = projectCacheKey(orgId, projectId);

  config.projectCache = {
    ...config.projectCache,
    [key]: {
      ...info,
      cachedAt: Date.now(),
    },
  };

  await writeConfig(config);
}

/**
 * Clear the project cache
 */
export async function clearProjectCache(): Promise<void> {
  const config = await readConfig();
  config.projectCache = undefined;
  await writeConfig(config);
}
