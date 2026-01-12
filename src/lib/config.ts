/**
 * Configuration Management
 *
 * Handles reading/writing the ~/.sentry-cli-next/config.json file.
 * Permissions follow SSH conventions for sensitive files.
 *
 * @see https://superuser.com/a/215506/26230
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CachedProject, SentryConfig } from "../types/index.js";

const CONFIG_DIR = join(homedir(), ".sentry-cli-next");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Ensure the config directory exists
 *
 * Permissions:
 * - Directory: 700 (drwx------)
 * - Config file: 600 (-rw-------)
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Read the configuration file
 */
export function readConfig(): SentryConfig {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return {};
    }
    const content = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(content) as SentryConfig;
  } catch {
    return {};
  }
}

/**
 * Write the configuration file
 */
export function writeConfig(config: SentryConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

/**
 * Update specific fields in the configuration
 */
export function updateConfig(updates: Partial<SentryConfig>): SentryConfig {
  const config = readConfig();
  const newConfig = { ...config, ...updates };
  writeConfig(newConfig);
  return newConfig;
}

/**
 * Get the stored authentication token
 */
export function getAuthToken(): string | undefined {
  const config = readConfig();

  // Check if token has expired
  if (config.auth?.expiresAt && Date.now() > config.auth.expiresAt) {
    return;
  }

  return config.auth?.token;
}

/**
 * Store authentication credentials
 */
export function setAuthToken(
  token: string,
  expiresIn?: number,
  refreshToken?: string
): void {
  const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined;

  updateConfig({
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
export function clearAuth(): void {
  const config = readConfig();
  config.auth = undefined;
  writeConfig(config);
}

/**
 * Get default organization
 */
export function getDefaultOrganization(): string | undefined {
  return readConfig().defaults?.organization;
}

/**
 * Get default project
 */
export function getDefaultProject(): string | undefined {
  return readConfig().defaults?.project;
}

/**
 * Set default organization and/or project
 */
export function setDefaults(organization?: string, project?: string): void {
  const config = readConfig();
  config.defaults = {
    ...config.defaults,
    ...(organization && { organization }),
    ...(project && { project }),
  };
  writeConfig(config);
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return !!getAuthToken();
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
export function getCachedProject(
  orgId: string,
  projectId: string
): CachedProject | undefined {
  const config = readConfig();
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
export function setCachedProject(
  orgId: string,
  projectId: string,
  info: Omit<CachedProject, "cachedAt">
): void {
  const config = readConfig();
  const key = projectCacheKey(orgId, projectId);

  config.projectCache = {
    ...config.projectCache,
    [key]: {
      ...info,
      cachedAt: Date.now(),
    },
  };

  writeConfig(config);
}

/**
 * Clear the project cache
 */
export function clearProjectCache(): void {
  const config = readConfig();
  config.projectCache = undefined;
  writeConfig(config);
}
