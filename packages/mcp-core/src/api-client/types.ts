/**
 * TypeScript type definitions derived from Zod schemas.
 *
 * This module provides strongly-typed interfaces for all Sentry API data
 * structures. Types are automatically derived from their corresponding
 * Zod schemas using `z.infer<>`, ensuring perfect synchronization between
 * runtime validation and compile-time type checking.
 *
 * Type Categories:
 * - **Core Resources**: User, Organization, Team, Project
 * - **Issue Management**: Issue, Event, AssignedTo
 * - **Release Management**: Release
 * - **Search & Discovery**: Tag
 * - **Integrations**: ClientKey, AutofixRun, AutofixRunState
 *
 * Array Types:
 * All list types follow the pattern `ResourceList = Resource[]` for consistency.
 *
 * @example Type Usage
 * ```typescript
 * import type { Issue, IssueList } from "./types";
 *
 * function processIssues(issues: IssueList): void {
 *   issues.forEach((issue: Issue) => {
 *     console.log(`${issue.shortId}: ${issue.title}`);
 *   });
 * }
 * ```
 *
 * @example API Response Typing
 * ```typescript
 * async function getIssue(id: string): Promise<Issue> {
 *   const response = await apiService.getIssue({
 *     organizationSlug: "my-org",
 *     issueId: id
 *   });
 *   return response; // Already typed as Issue from schema validation
 * }
 * ```
 */
import type { z } from "zod";
import type {
  AssignedToSchema,
  AutofixRunSchema,
  AutofixRunStateSchema,
  ClientKeyListSchema,
  ClientKeySchema,
  ErrorEventSchema,
  DefaultEventSchema,
  TransactionEventSchema,
  GenericEventSchema,
  UnknownEventSchema,
  EventSchema,
  EventAttachmentSchema,
  EventAttachmentListSchema,
  IssueListSchema,
  IssueSchema,
  IssueTagValuesSchema,
  OrganizationListSchema,
  OrganizationSchema,
  ProjectListSchema,
  ProjectSchema,
  ReleaseListSchema,
  ReleaseSchema,
  TagListSchema,
  TagSchema,
  TeamListSchema,
  TeamSchema,
  TraceMetaSchema,
  TraceSchema,
  TraceSpanSchema,
  TraceIssueSchema,
  UserSchema,
  FlamegraphSchema,
  FlamegraphFrameSchema,
  FlamegraphFrameInfoSchema,
  FlamegraphProfileSchema,
  FlamegraphProfileMetadataSchema,
  ProfileChunkSchema,
  ProfileChunkResponseSchema,
  ProfileFrameSchema,
  ProfileSampleSchema,
} from "./schema";

export type User = z.infer<typeof UserSchema>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type Team = z.infer<typeof TeamSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ClientKey = z.infer<typeof ClientKeySchema>;
export type Release = z.infer<typeof ReleaseSchema>;
export type Issue = z.infer<typeof IssueSchema>;

// Individual event types
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
export type DefaultEvent = z.infer<typeof DefaultEventSchema>;
export type TransactionEvent = z.infer<typeof TransactionEventSchema>;
export type GenericEvent = z.infer<typeof GenericEventSchema>;
export type UnknownEvent = z.infer<typeof UnknownEventSchema>;

// Event union - use RawEvent for parsing, Event for all event types including unknown
export type RawEvent = z.infer<typeof EventSchema>;
export type Event =
  | ErrorEvent
  | DefaultEvent
  | TransactionEvent
  | GenericEvent
  | UnknownEvent;

export type EventAttachment = z.infer<typeof EventAttachmentSchema>;
export type Tag = z.infer<typeof TagSchema>;
export type AutofixRun = z.infer<typeof AutofixRunSchema>;
export type AutofixRunState = z.infer<typeof AutofixRunStateSchema>;
export type AssignedTo = z.infer<typeof AssignedToSchema>;

export type OrganizationList = z.infer<typeof OrganizationListSchema>;
export type TeamList = z.infer<typeof TeamListSchema>;
export type ProjectList = z.infer<typeof ProjectListSchema>;
export type ReleaseList = z.infer<typeof ReleaseListSchema>;
export type IssueList = z.infer<typeof IssueListSchema>;
export type EventAttachmentList = z.infer<typeof EventAttachmentListSchema>;
export type TagList = z.infer<typeof TagListSchema>;
export type ClientKeyList = z.infer<typeof ClientKeyListSchema>;

// Trace types
export type TraceMeta = z.infer<typeof TraceMetaSchema>;
export type TraceSpan = z.infer<typeof TraceSpanSchema>;
export type TraceIssue = z.infer<typeof TraceIssueSchema>;
export type Trace = z.infer<typeof TraceSchema>;

// Profile types
export type Flamegraph = z.infer<typeof FlamegraphSchema>;
export type FlamegraphFrame = z.infer<typeof FlamegraphFrameSchema>;
export type FlamegraphFrameInfo = z.infer<typeof FlamegraphFrameInfoSchema>;
export type FlamegraphProfile = z.infer<typeof FlamegraphProfileSchema>;
export type FlamegraphProfileMetadata = z.infer<
  typeof FlamegraphProfileMetadataSchema
>;
export type ProfileChunk = z.infer<typeof ProfileChunkSchema>;
export type ProfileChunkResponse = z.infer<typeof ProfileChunkResponseSchema>;
export type ProfileFrame = z.infer<typeof ProfileFrameSchema>;
export type ProfileSample = z.infer<typeof ProfileSampleSchema>;

// Issue tag values
export type IssueTagValues = z.infer<typeof IssueTagValuesSchema>;
