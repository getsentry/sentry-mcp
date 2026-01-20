/**
 * Sentry API Types
 *
 * Types representing Sentry API resources.
 * Zod schemas provide runtime validation, types are inferred from schemas.
 * Schemas are lenient to handle API variations - only core identifiers are required.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Organization
// ─────────────────────────────────────────────────────────────────────────────

export const SentryOrganizationSchema = z
  .object({
    // Core identifiers (required)
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    // Optional metadata
    dateCreated: z.string().optional(),
    isEarlyAdopter: z.boolean().optional(),
    require2FA: z.boolean().optional(),
    avatar: z
      .object({
        avatarType: z.string(),
        avatarUuid: z.string().nullable(),
      })
      .passthrough()
      .optional(),
    features: z.array(z.string()).optional(),
  })
  .passthrough();

export type SentryOrganization = z.infer<typeof SentryOrganizationSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Project
// ─────────────────────────────────────────────────────────────────────────────

export const SentryProjectSchema = z
  .object({
    // Core identifiers (required)
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    // Optional metadata
    platform: z.string().nullable().optional(),
    dateCreated: z.string().optional(),
    isBookmarked: z.boolean().optional(),
    isMember: z.boolean().optional(),
    features: z.array(z.string()).optional(),
    firstEvent: z.string().nullable().optional(),
    firstTransactionEvent: z.boolean().optional(),
    access: z.array(z.string()).optional(),
    hasAccess: z.boolean().optional(),
    hasMinifiedStackTrace: z.boolean().optional(),
    hasMonitors: z.boolean().optional(),
    hasProfiles: z.boolean().optional(),
    hasReplays: z.boolean().optional(),
    hasSessions: z.boolean().optional(),
    isInternal: z.boolean().optional(),
    isPublic: z.boolean().optional(),
    avatar: z
      .object({
        avatarType: z.string(),
        avatarUuid: z.string().nullable(),
      })
      .passthrough()
      .optional(),
    color: z.string().optional(),
    status: z.string().optional(),
    organization: z
      .object({
        id: z.string(),
        slug: z.string(),
        name: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type SentryProject = z.infer<typeof SentryProjectSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Issue Status & Level Constants
// ─────────────────────────────────────────────────────────────────────────────

export const ISSUE_STATUSES = ["resolved", "unresolved", "ignored"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_LEVELS = [
  "fatal",
  "error",
  "warning",
  "info",
  "debug",
] as const;
export type IssueLevel = (typeof ISSUE_LEVELS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Issue
// ─────────────────────────────────────────────────────────────────────────────

export const SentryIssueSchema = z
  .object({
    // Core identifiers (required)
    id: z.string(),
    shortId: z.string(),
    title: z.string(),
    // Optional metadata
    culprit: z.string().optional(),
    permalink: z.string().optional(),
    logger: z.string().nullable().optional(),
    level: z.string().optional(),
    status: z.enum(ISSUE_STATUSES).optional(),
    statusDetails: z.record(z.unknown()).optional(),
    isPublic: z.boolean().optional(),
    platform: z.string().optional(),
    project: z
      .object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        platform: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
    type: z.string().optional(),
    metadata: z
      .object({
        value: z.string().optional(),
        type: z.string().optional(),
        filename: z.string().optional(),
        function: z.string().optional(),
        display_title_with_tree_label: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    numComments: z.number().optional(),
    assignedTo: z
      .object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
      })
      .passthrough()
      .nullable()
      .optional(),
    isBookmarked: z.boolean().optional(),
    isSubscribed: z.boolean().optional(),
    subscriptionDetails: z
      .object({
        reason: z.string().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    hasSeen: z.boolean().optional(),
    annotations: z.array(z.string()).optional(),
    isUnhandled: z.boolean().optional(),
    count: z.string().optional(),
    userCount: z.number().optional(),
    firstSeen: z.string().optional(),
    lastSeen: z.string().optional(),
  })
  .passthrough();

export type SentryIssue = z.infer<typeof SentryIssueSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Event
// ─────────────────────────────────────────────────────────────────────────────

export const SentryEventSchema = z
  .object({
    // Core identifier (required)
    eventID: z.string(),
    // Optional metadata
    id: z.string().optional(),
    projectID: z.string().optional(),
    context: z.record(z.unknown()).optional(),
    contexts: z.record(z.unknown()).optional(),
    dateCreated: z.string().optional(),
    dateReceived: z.string().optional(),
    entries: z.array(z.unknown()).optional(),
    errors: z.array(z.unknown()).optional(),
    fingerprints: z.array(z.string()).optional(),
    groupID: z.string().optional(),
    message: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    platform: z.string().optional(),
    sdk: z
      .object({
        name: z.string(),
        version: z.string(),
      })
      .passthrough()
      .nullable()
      .optional(),
    tags: z
      .array(
        z.object({
          key: z.string(),
          value: z.string(),
        })
      )
      .optional(),
    title: z.string().optional(),
    type: z.string().optional(),
    user: z
      .object({
        id: z.string().optional(),
        email: z.string().optional(),
        username: z.string().optional(),
        ip_address: z.string().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export type SentryEvent = z.infer<typeof SentryEventSchema>;
