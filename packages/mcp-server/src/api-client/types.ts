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
  EventSchema,
  IssueListSchema,
  IssueSchema,
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
  UserSchema,
  IssueAlertRuleSchema,
  IssueAlertRuleListSchema,
} from "./schema";

export type User = z.infer<typeof UserSchema>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type Team = z.infer<typeof TeamSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ClientKey = z.infer<typeof ClientKeySchema>;
export type Release = z.infer<typeof ReleaseSchema>;
export type Issue = z.infer<typeof IssueSchema>;
export type Event = z.infer<typeof EventSchema>;
export type Tag = z.infer<typeof TagSchema>;
export type AutofixRun = z.infer<typeof AutofixRunSchema>;
export type AutofixRunState = z.infer<typeof AutofixRunStateSchema>;
export type AssignedTo = z.infer<typeof AssignedToSchema>;

export type OrganizationList = z.infer<typeof OrganizationListSchema>;
export type TeamList = z.infer<typeof TeamListSchema>;
export type ProjectList = z.infer<typeof ProjectListSchema>;
export type ReleaseList = z.infer<typeof ReleaseListSchema>;
export type IssueList = z.infer<typeof IssueListSchema>;
export type TagList = z.infer<typeof TagListSchema>;
export type ClientKeyList = z.infer<typeof ClientKeyListSchema>;

export type IssueAlertRule = z.infer<typeof IssueAlertRuleSchema>;
export type IssueAlertRuleList = z.infer<typeof IssueAlertRuleListSchema>;
