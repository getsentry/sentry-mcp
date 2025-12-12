/**
 * Configuration Types
 *
 * Types for the sry CLI configuration file.
 */

import type { CachedProject } from "./dsn.js";

export type SryConfig = {
  auth?: {
    token?: string;
    refreshToken?: string;
    expiresAt?: number;
  };
  defaults?: {
    organization?: string;
    project?: string;
  };
  /**
   * Cache of DSN → project info mappings
   * Key format: "{orgId}:{projectId}"
   */
  projectCache?: Record<string, CachedProject>;
};
