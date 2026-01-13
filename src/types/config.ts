/**
 * Configuration Types
 *
 * Types and Zod schemas for the Sentry CLI configuration file.
 */

import { z } from "zod";

/**
 * Schema for cached project information
 */
export const CachedProjectSchema = z.object({
  orgSlug: z.string(),
  orgName: z.string(),
  projectSlug: z.string(),
  projectName: z.string(),
  cachedAt: z.number(),
});

export type CachedProject = z.infer<typeof CachedProjectSchema>;

/**
 * Schema for authentication configuration
 */
export const AuthConfigSchema = z.object({
  token: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
});

/**
 * Schema for default organization/project settings
 */
export const DefaultsConfigSchema = z.object({
  organization: z.string().optional(),
  project: z.string().optional(),
});

/**
 * Schema for the full Sentry CLI configuration file
 */
export const SentryConfigSchema = z.object({
  auth: AuthConfigSchema.optional(),
  defaults: DefaultsConfigSchema.optional(),
  /**
   * Cache of DSN -> project info mappings
   * Key format: "{orgId}:{projectId}"
   */
  projectCache: z.record(CachedProjectSchema).optional(),
});

export type SentryConfig = z.infer<typeof SentryConfigSchema>;
