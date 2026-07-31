/**
 * Configuration Types
 *
 * Types and Zod schemas for the Sentry CLI configuration file.
 */

import { z } from "zod";
import { CachedDsnEntrySchema } from "../lib/dsn/types.js";

/**
 * Schema for cached project information
 */
export const CachedProjectSchema = z.object({
  orgSlug: z.string(),
  orgName: z.string(),
  projectSlug: z.string(),
  projectName: z.string(),
  projectId: z.string().optional(),
  cachedAt: z.number(),
});

export type CachedProject = z.infer<typeof CachedProjectSchema>;

/**
 * Schema for project alias entry (used for short issue ID resolution)
 */
export const ProjectAliasEntrySchema = z.object({
  orgSlug: z.string(),
  projectSlug: z.string(),
});

export type ProjectAliasEntry = z.infer<typeof ProjectAliasEntrySchema>;

/**
 * Schema for cached project aliases (A, B, C... -> org/project mapping).
 * Scoped by DSN fingerprint to prevent cross-project conflicts in monorepos.
 */
export const ProjectAliasesSchema = z.object({
  /** Map of alias letter to project info */
  aliases: z.record(ProjectAliasEntrySchema),
  /** Timestamp when aliases were set */
  cachedAt: z.number(),
  /**
   * Fingerprint of detected DSNs for validation.
   * Format: sorted comma-separated list of "orgId:projectId" pairs.
   * Aliases only valid when current DSN detection matches this fingerprint.
   */
  dsnFingerprint: z.string().optional(),
});

export type ProjectAliases = z.infer<typeof ProjectAliasesSchema>;

/**
 * Schema for authentication configuration
 */
export const AuthConfigSchema = z.object({
  token: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  issuedAt: z.number().optional(),
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
  /**
   * Cache of detected DSNs per directory
   * Key: absolute directory path
   * Value: cached DSN entry with source and resolution info
   */
  dsnCache: z.record(CachedDsnEntrySchema).optional(),
  /**
   * Cached project aliases for short issue ID resolution.
   * Scoped by DSN fingerprint to prevent cross-project conflicts.
   * Set by `issue list` when multiple projects are detected.
   */
  projectAliases: ProjectAliasesSchema.optional(),
});

export type SentryConfig = z.infer<typeof SentryConfigSchema>;
