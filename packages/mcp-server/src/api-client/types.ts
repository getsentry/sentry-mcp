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
