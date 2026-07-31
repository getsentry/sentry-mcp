/**
 * Sentry API Types
 *
 * Types representing Sentry API resources.
 *
 * SDK-backed types (Organization, Project, Issue, Event, ProjectKey) are derived
 * from `@sentry/api` response types using `Partial<SdkType> & RequiredCore`.
 * This keeps all SDK-documented fields available with correct types while making
 * non-core fields optional for flexibility (test mocks, partial API responses).
 *
 * Internal types not covered by the SDK (Region, User, logs) use Zod schemas
 * for runtime validation. Event entry types (exceptions, breadcrumbs, etc.)
 * are plain TypeScript interfaces since they are only used for type annotations.
 */

import type {
  IssueEventDetailsResponse,
  DeployResponse as SdkDeployResponse,
  GetOrganizationIssueResponse as SdkIssueDetail,
  ListOrganizations as SdkOrganizationList,
  ProjectKey as SdkProjectKey,
  OrganizationProjectResponseDict as SdkProjectList,
  OrgReleaseResponse as SdkReleaseResponse,
  BaseTeam as SdkTeam,
} from "@sentry/api";
import {
  zBaseTeam,
  zGetOrganizationIssueResponse,
  zGroupEventsResponseDict,
} from "@sentry/api/zod";
import { z } from "zod";

// SDK-derived types

// Organization

/**
 * A Sentry organization.
 *
 * Based on the `@sentry/api` list-organizations response type.
 * Core identifiers are required; other SDK fields are available but optional,
 * allowing test mocks and list-endpoint responses to omit them.
 *
 * `allowMemberProjectCreation` and `orgRole` are present in detail responses
 * (GET /api/0/organizations/{slug}/) but absent from list responses, hence
 * optional. `allowMemberProjectCreation` being false means
 * Organization.flags.disable_member_project_creation is set — project creation
 * requires org:write scope or team:admin on the target team.
 */
export type SentryOrganization = Partial<SdkOrganizationList[number]> & {
  id: string;
  slug: string;
  name: string;
  /** False when org admins have restricted project creation to owners/managers/team-admins. Default for new orgs. */
  allowMemberProjectCreation?: boolean;
  /** The authenticated user's role in this org ("member", "admin", "manager", "owner"). */
  orgRole?: string;
};

// Project

/** Element type of the SDK's list-projects response */
type SdkProjectListItem = SdkProjectList[number];

/**
 * A Sentry project.
 *
 * Based on the `@sentry/api` list-projects response type.
 * The `organization` field is present in detail responses but absent in list responses,
 * so it is declared as an optional extension.
 */
export type SentryProject = Partial<SdkProjectListItem> & {
  id: string;
  slug: string;
  name: string;
  /**
   * Organization context (present in detail responses, absent in list).
   *
   * `name` is optional because `getProject()` passes `?collapse=organization`
   * to skip full-org serialization on the server (~400-500ms faster). The
   * collapsed payload only carries `{id, slug}`. Callers needing a display
   * name should use `resolveOrgDisplayName()` which falls back to the
   * cached organizations list.
   */
  organization?: {
    id: string;
    slug: string;
    name?: string;
    [key: string]: unknown;
  };
  /** Project status (returned by API but not in the OpenAPI spec) */
  status?: string;
};

// Issue Constants

/**
 * Runtime-iterable tuple of issue status values, tied to the SDK's literal
 * union in both directions:
 *
 * - `satisfies readonly NonNullable<SdkIssueDetail["status"]>[]` catches
 *   **removals/renames** in the SDK union (a tuple entry that no longer
 *   exists in the union fails to assign).
 * - `_IssueStatusParity` below catches **additions** in the SDK union
 *   (an SDK status missing from our tuple makes the conditional type
 *   reduce to `never` instead of `true`).
 *
 * Together they fail typechecking on any drift, forcing the tuple and the
 * SDK union to stay in sync.
 */
export const ISSUE_STATUSES = [
  "resolved",
  "resolvedInNextRelease",
  "unresolved",
  "ignored",
  "muted",
] as const satisfies readonly NonNullable<SdkIssueDetail["status"]>[];
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

// Note: a reverse exhaustiveness check (SDK → ISSUE_STATUSES) is not possible here
// because GetOrganizationIssueResponses is a union of all HTTP response types, one of which
// has `status: string` (loose), making SdkIssueDetail["status"] resolve to `string`.
// The `satisfies` above catches the forward direction (invalid values in our tuple).

export const ISSUE_LEVELS = [
  "fatal",
  "error",
  "warning",
  "info",
  "debug",
] as const;
export type IssueLevel = (typeof ISSUE_LEVELS)[number];

// Issue

/**
 * A Sentry issue.
 *
 * Based on the `@sentry/api` retrieve-issue response type.
 * Core identifiers are required; other SDK fields are available but optional.
 * Includes extensions for fields returned by the API but not in the OpenAPI spec.
 *
 * The `metadata` field is overridden from the SDK's discriminated union to a single
 * object with all optional fields, matching how the API actually returns data.
 */
export type SentryIssue = Omit<Partial<SdkIssueDetail>, "metadata"> & {
  id: string;
  shortId: string;
  title: string;
  /** Issue metadata (value, filename, function, etc.) */
  metadata?: {
    value?: string;
    type?: string;
    filename?: string;
    function?: string;
    title?: string;
    display_title_with_tree_label?: boolean;
    [key: string]: unknown;
  };
  /** Issue substatus (not in OpenAPI spec) */
  substatus?: string | null;
  /** Issue priority (not in OpenAPI spec) */
  priority?: string;
  /** Whether the issue is unhandled (not in OpenAPI spec) */
  isUnhandled?: boolean;
  /** Platform of the issue (not in OpenAPI spec) */
  platform?: string;
  /**
   * Seer AI fixability score (0-1). Higher = easier to fix automatically.
   * `null` when Seer has not analyzed this issue; absent when the org has Seer disabled.
   */
  seerFixabilityScore?: number | null;
};

/**
 * Zod schema describing the key fields of a {@link SentryIssue} for JSON output.
 *
 * This is a documentation-oriented schema — it describes the commonly-available
 * fields that appear in `--json` output, used by the help system and SKILL.md
 * generation to inform agents and users about available `--fields` selections.
 *
 * Not a validation schema — the actual API response may include additional
 * SDK-derived fields not listed here. Fields listed as optional may still be
 * present in most responses; optionality reflects the TypeScript type.
 */
/**
 * Derived from the auto-generated `zGetOrganizationIssueResponse` schema.
 *
 * The generated schema makes all API-documented fields required. We widen it
 * with `.partial()` so only the core identifiers (id, shortId, title) are
 * required — matching how the CLI uses partial API responses and test mocks.
 * Extra fields not in the OpenAPI spec (substatus, priority, isUnhandled,
 * seerFixabilityScore) are added via `.extend()`.
 */
export const SentryIssueSchema = zGetOrganizationIssueResponse
  .pick({
    id: true,
    shortId: true,
    title: true,
    culprit: true,
    count: true,
    userCount: true,
    firstSeen: true,
    lastSeen: true,
    level: true,
    status: true,
    permalink: true,
    project: true,
    metadata: true,
    assignedTo: true,
  })
  .partial()
  .extend({
    id: z.string().describe("Numeric issue ID"),
    shortId: z.string().describe("Human-readable short ID (e.g. PROJ-ABC)"),
    title: z.string().describe("Issue title"),
    culprit: zGetOrganizationIssueResponse.shape.culprit
      .optional()
      .describe("Culprit string"),
    count: zGetOrganizationIssueResponse.shape.count
      .optional()
      .describe("Total event count"),
    userCount: zGetOrganizationIssueResponse.shape.userCount
      .optional()
      .describe("Number of affected users"),
    firstSeen: zGetOrganizationIssueResponse.shape.firstSeen
      .optional()
      .describe("First occurrence (ISO 8601)"),
    lastSeen: zGetOrganizationIssueResponse.shape.lastSeen
      .optional()
      .describe("Most recent occurrence (ISO 8601)"),
    level: zGetOrganizationIssueResponse.shape.level
      .optional()
      .describe("Severity level"),
    status: zGetOrganizationIssueResponse.shape.status
      .optional()
      .describe("Issue status"),
    permalink: zGetOrganizationIssueResponse.shape.permalink
      .optional()
      .describe("URL to the issue in Sentry"),
    project: zGetOrganizationIssueResponse.shape.project
      .optional()
      .describe("Project info"),
    metadata: zGetOrganizationIssueResponse.shape.metadata
      .optional()
      .describe("Issue metadata"),
    assignedTo: zGetOrganizationIssueResponse.shape.assignedTo
      .optional()
      .describe("Assigned user or team"),
    priority: z.string().optional().describe("Triage priority"),
    platform: z.string().optional().describe("Platform"),
    substatus: z.string().nullable().optional().describe("Issue substatus"),
    isUnhandled: z
      .boolean()
      .optional()
      .describe("Whether the issue is unhandled"),
    seerFixabilityScore: z
      .number()
      .nullable()
      .optional()
      .describe("Seer AI fixability score (0-1)"),
  })
  .passthrough()
  .describe("Sentry issue");

/**
 * Documentation-oriented schema for `issue view` JSON output.
 *
 * The view command's jsonTransform spreads all issue fields at the top level
 * and adds enrichment fields (`event`, `org`, `replayIds`, `trace`). This
 * schema describes that flattened shape for `--help`, `sentry help issue view`,
 * and SKILL.md field table generation.
 */
export const IssueViewOutputSchema = SentryIssueSchema.extend({
  event: z
    .unknown()
    .nullable()
    .optional()
    .describe("Latest event for the issue (full detail)"),
  org: z.string().nullable().optional().describe("Organization slug"),
  replayIds: z
    .array(z.string())
    .optional()
    .describe("Related Session Replay IDs"),
  trace: z
    .object({
      traceId: z.string().describe("Trace ID from the latest event"),
      spans: z.array(z.unknown()).describe("Span tree data"),
    })
    .nullable()
    .optional()
    .describe("Trace context from the latest event's span tree"),
}).describe("Issue view output");

// Event

/**
 * A Sentry event.
 *
 * Based on the `@sentry/api` IssueEventDetailsResponse type.
 * Core identifier (eventID) is required; other SDK fields are available but optional.
 *
 * The `contexts` field is overridden from the SDK's generic `Record<string,unknown>`
 * to include typed sub-contexts (trace, browser, os, device) that our formatters access.
 * Additional fields not in the OpenAPI spec are also included.
 */
export type SentryEvent = Omit<
  Partial<IssueEventDetailsResponse>,
  "contexts"
> & {
  eventID: string;
  /** Event contexts with typed sub-contexts */
  contexts?: {
    trace?: TraceContext;
    browser?: BrowserContext;
    os?: OsContext;
    device?: DeviceContext;
    replay?: ReplayContext;
    [key: string]: unknown;
  } | null;
  /** Date the event was created (not in OpenAPI spec) */
  dateCreated?: string;
  /** Event fingerprints (not in OpenAPI spec) */
  fingerprints?: string[];
  /** Release associated with the event (not in OpenAPI spec) */
  release?: {
    version: string;
    shortVersion?: string;
    dateCreated?: string;
    dateReleased?: string | null;
    [key: string]: unknown;
  } | null;
  /** SDK update suggestions (not in OpenAPI spec) */
  sdkUpdates?: Array<{
    type?: string;
    sdkName?: string;
    newSdkVersion?: string;
    sdkUrl?: string;
    [key: string]: unknown;
  }>;
  /** URL/function where the error occurred (not in OpenAPI spec for events) */
  culprit?: string | null;
};

// Issue Event (list endpoint)

/**
 * A lightweight event from the issue events list endpoint.
 *
 * This is a subset of the full event detail — the list endpoint returns
 * minimal event metadata without stacktraces, breadcrumbs, or contexts.
 * Use {@link SentryEvent} for full event details from the detail endpoint.
 */
export type IssueEvent = {
  /** Internal event ID (numeric string) */
  id: string;
  /** Event type (e.g., "error", "default", "transaction") */
  "event.type": string;
  /** The group (issue) ID this event belongs to */
  groupID: string | null;
  /** UUID-format event ID */
  eventID: string;
  /** Project ID (numeric string) */
  projectID: string;
  /** Event message */
  message: string;
  /** Event title (typically the error type + message) */
  title: string;
  /** Source location (file:line) where the event originated */
  location: string | null;
  /** The culprit (function/module that caused the error) */
  culprit: string | null;
  /** User context if available */
  user: {
    id?: string | null;
    email?: string | null;
    username?: string | null;
    ip_address?: string | null;
    name?: string | null;
  } | null;
  /** Event tags */
  tags: Array<{ key: string; value: string }>;
  /** Platform (e.g., "python", "javascript") */
  platform: string | null;
  /** ISO 8601 timestamp when the event was created */
  dateCreated: string;
  /** Crash file URL if available */
  crashFile: string | null;
  /** Event metadata */
  metadata: Record<string, unknown> | null;
};

/**
 * Zod schema for {@link IssueEvent} — used for `--fields` documentation in `--help`.
 *
 * Derived from the auto-generated `zGroupEventsResponseDict` element schema.
 * All generated fields are widened to optional via `.partial()`, then the core
 * identifiers (id, event.type, eventID) are re-required via `.extend()`.
 */
const _IssueEventElement = zGroupEventsResponseDict.element;
export const IssueEventSchema = _IssueEventElement
  .partial()
  .extend({
    id: z.string().describe("Internal event ID"),
    "event.type": z
      .string()
      .describe("Event type (error, default, transaction)"),
    groupID: _IssueEventElement.shape.groupID
      .optional()
      .describe("Group (issue) ID"),
    eventID: z.string().describe("UUID-format event ID"),
    projectID: _IssueEventElement.shape.projectID
      .optional()
      .describe("Project ID"),
    message: _IssueEventElement.shape.message
      .optional()
      .describe("Event message"),
    title: _IssueEventElement.shape.title.optional().describe("Event title"),
    location: _IssueEventElement.shape.location
      .optional()
      .describe("Source location (file:line)"),
    culprit: _IssueEventElement.shape.culprit
      .optional()
      .describe("Culprit function/module"),
    user: _IssueEventElement.shape.user.optional().describe("User context"),
    tags: _IssueEventElement.shape.tags.optional().describe("Event tags"),
    platform: _IssueEventElement.shape.platform
      .optional()
      .describe("Platform (python, javascript, etc.)"),
    dateCreated: _IssueEventElement.shape.dateCreated
      .optional()
      .describe("ISO 8601 creation timestamp"),
    crashFile: _IssueEventElement.shape.crashFile
      .optional()
      .describe("Crash file URL"),
    metadata: _IssueEventElement.shape.metadata
      .optional()
      .describe("Event metadata"),
  })
  .passthrough()
  .describe("Issue event (list endpoint)");

// Project Keys (DSN)

/**
 * A Sentry project key (DSN).
 *
 * Based on the `@sentry/api` ProjectKey type.
 * Core fields are required; other SDK fields are available but optional.
 */
export type ProjectKey = Partial<SdkProjectKey> & {
  id: string;
  name: string;
  isActive: boolean;
  dsn: {
    public: string;
    secret: string;
    [key: string]: unknown;
  };
};

// Internal types with Zod schemas (runtime-validated, not in @sentry/api)

// Region

/** A Sentry region (e.g., US, EU) */
export const RegionSchema = z.object({
  name: z.string(),
  url: z.string().url(),
});

export type Region = z.infer<typeof RegionSchema>;

/** Response from /api/0/users/me/regions/ endpoint */
export const UserRegionsResponseSchema = z.object({
  regions: z.array(RegionSchema),
});

export type UserRegionsResponse = z.infer<typeof UserRegionsResponseSchema>;

// User

/**
 * Minimal user schema for the `/auth/` endpoint response.
 *
 * All optional fields use `.nullish()` (accepts both `null` and `undefined`)
 * because the Sentry API can return `null` for any of these.
 * Note: `@sentry/api` doesn't export types for the `/auth/` endpoint —
 * it's undocumented, so we define this schema manually.
 */
export const SentryUserSchema = z
  .object({
    id: z.string(),
    email: z.string().nullish(),
    username: z.string().nullish(),
    name: z.string().nullish(),
  })
  .passthrough();

export type SentryUser = z.infer<typeof SentryUserSchema>;

// Plain TypeScript interfaces (type annotations only, no runtime validation)

// Event Contexts

/** Trace context from event.contexts.trace */
export type TraceContext = {
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string | null;
  op?: string;
  status?: string;
  description?: string | null;
  [key: string]: unknown;
};

/** Browser context from event.contexts.browser */
export type BrowserContext = {
  name?: string;
  version?: string;
  type?: "browser";
  [key: string]: unknown;
};

/** Operating system context from event.contexts.os */
export type OsContext = {
  name?: string;
  version?: string;
  type?: "os";
  [key: string]: unknown;
};

/** Device context from event.contexts.device */
export type DeviceContext = {
  family?: string;
  model?: string;
  brand?: string;
  type?: "device";
  [key: string]: unknown;
};

/** Replay context from event.contexts.replay */
export type ReplayContext = {
  replay_id?: string;
  [key: string]: unknown;
};

/** High-level metadata returned by the organization trace-meta endpoint. */
export const TraceMetaSchema = z
  .object({
    logs: z.number().describe("Log entry count"),
    errors: z.number().describe("Error count"),
    performance_issues: z.number().describe("Performance issue count"),
    span_count: z.number().describe("Span count"),
    transaction_child_count_map: z
      .array(
        z.object({
          "transaction.event_id": z
            .string()
            .nullable()
            .describe("Transaction event ID"),
          "count()": z.number().describe("Transaction child count"),
        })
      )
      .describe("Per-transaction child counts"),
    span_count_map: z
      .record(z.string(), z.number())
      .describe("Span counts grouped by operation"),
  })
  .describe("Trace metadata");

export type TraceMeta = z.infer<typeof TraceMetaSchema>;

export const ISSUE_PRIORITIES = ["high", "medium", "low"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export const ISSUE_SUBSTATUSES = [
  "ongoing",
  "escalating",
  "regressed",
  "new",
  "archived_until_escalating",
  "archived_until_condition_met",
  "archived_forever",
] as const;
export type IssueSubstatus = (typeof ISSUE_SUBSTATUSES)[number];

// Release

/**
 * A Sentry release.
 *
 * Based on the `@sentry/api` org-release response type (`OrgReleaseResponse`).
 * Only `version` is unconditionally required; all other SDK fields (id, status,
 * versionInfo, data, authors, projects, ...) are widened to optional so test
 * fixtures and partial API responses can omit them without casts.
 */
export type SentryRelease = Partial<SdkReleaseResponse> & {
  version: string;
};

// Deploy

/**
 * A Sentry deploy.
 *
 * Based on the `@sentry/api` deploy response type (`DeployResponse`).
 * Core identifiers are required; timestamps and display fields are widened
 * to optional so test mocks can omit `dateStarted`, `dateFinished`, `name`,
 * and `url`.
 */
export type SentryDeploy = Partial<SdkDeployResponse> & {
  id: string;
  environment: string;
};

// Issue

// Span (for trace tree display)

/** A single span in a trace */
export const SpanSchema = z
  .object({
    span_id: z.string(),
    parent_span_id: z.string().nullable().optional(),
    trace_id: z.string().optional(),
    op: z.string().optional(),
    description: z.string().nullable().optional(),
    /** Start time as Unix timestamp (seconds with fractional ms) */
    start_timestamp: z.number(),
    /** End time as Unix timestamp (seconds with fractional ms) */
    timestamp: z.number(),
    status: z.string().optional(),
    data: z.record(z.unknown()).optional(),
    tags: z.record(z.string()).optional(),
  })
  .passthrough();

export type Span = z.infer<typeof SpanSchema>;

/**
 * Span from /trace/{traceId}/ endpoint with nested children.
 * This endpoint returns a hierarchical structure unlike /events-trace/.
 *
 * The API may return either `timestamp` or `end_timestamp` (or both) depending
 * on the span source. Code should check both fields when reading the end time.
 */
export type TraceSpan = {
  span_id: string;
  parent_span_id?: string | null;
  op?: string;
  description?: string | null;
  start_timestamp: number;
  /** End timestamp in seconds (legacy field, prefer end_timestamp) */
  timestamp?: number;
  /** End timestamp in seconds (preferred over timestamp) */
  end_timestamp?: number;
  /** Duration in milliseconds (when provided by the API) */
  duration?: number;
  transaction?: string;
  "transaction.op"?: string;
  project_slug?: string;
  event_id?: string;
  /** Nested child spans */
  children?: TraceSpan[];
  /** Span name (often same as op) */
  name?: string;
  /** Always "span" for EAP spans */
  event_type?: string;
  /** Whether this span is a transaction boundary */
  is_transaction?: boolean;
  /** Transaction event ID */
  transaction_id?: string;
  /** SDK that produced this span */
  sdk_name?: string;
  /** Profile ID (empty string when not profiled) */
  profile_id?: string;
  /** Profiler ID (empty string when not profiled) */
  profiler_id?: string;
  /** Web vitals and performance measurements (keyed by measurement name) */
  measurements?: Record<string, number>;
  /** Extra attributes requested via `additional_attributes` query param */
  additional_attributes?: Record<string, unknown>;
  /** Error issues attached to this span */
  errors?: unknown[];
  /** Performance issue occurrences on this span */
  occurrences?: unknown[];
};

// Stack Frame & Exception Entry

/** A single frame in a stack trace */
export type StackFrame = {
  filename?: string | null;
  absPath?: string | null;
  module?: string | null;
  package?: string | null;
  platform?: string | null;
  function?: string | null;
  rawFunction?: string | null;
  symbol?: string | null;
  lineNo?: number | null;
  colNo?: number | null;
  /** Whether this frame is in the user's application code */
  inApp?: boolean | null;
  /** Surrounding code lines: [[lineNo, code], ...] */
  context?: [number, string][] | null;
  vars?: Record<string, unknown> | null;
  instructionAddr?: string | null;
  symbolAddr?: string | null;
  trust?: string | null;
  errors?: unknown[] | null;
  [key: string]: unknown;
};

/** Stack trace containing frames */
export type Stacktrace = {
  frames?: StackFrame[];
  framesOmitted?: number[] | null;
  registers?: Record<string, string> | null;
  hasSystemFrames?: boolean;
  [key: string]: unknown;
};

/** Exception mechanism (how the error was captured) */
export type Mechanism = {
  type?: string;
  handled?: boolean;
  synthetic?: boolean;
  description?: string | null;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

/** A single exception value in the exception entry */
export type ExceptionValue = {
  type?: string | null;
  value?: string | null;
  module?: string | null;
  threadId?: string | number | null;
  mechanism?: Mechanism | null;
  stacktrace?: Stacktrace | null;
  rawStacktrace?: Stacktrace | null;
  [key: string]: unknown;
};

/** Exception entry in event.entries */
export type ExceptionEntry = {
  type: "exception";
  data: {
    values?: ExceptionValue[];
    excOmitted?: number[] | null;
    hasSystemFrames?: boolean;
    [key: string]: unknown;
  };
};

// Breadcrumbs Entry

/** A single breadcrumb */
export type Breadcrumb = {
  type?: string;
  category?: string | null;
  level?: string;
  message?: string | null;
  timestamp?: string;
  event_id?: string | null;
  data?: Record<string, unknown> | null;
  [key: string]: unknown;
};

/** Breadcrumbs entry in event.entries */
export type BreadcrumbsEntry = {
  type: "breadcrumbs";
  data: {
    values?: Breadcrumb[];
    [key: string]: unknown;
  };
};

// Request Entry

/** HTTP request entry in event.entries */
export type RequestEntry = {
  type: "request";
  data: {
    url?: string | null;
    method?: string | null;
    fragment?: string | null;
    query?: [string, string][] | string | Record<string, string> | null;
    data?: unknown;
    headers?: [string, string][] | null;
    cookies?: [string, string][] | Record<string, string> | null;
    env?: Record<string, string> | null;
    inferredContentType?: string | null;
    apiTarget?: string | null;
    [key: string]: unknown;
  };
};

// Log types (runtime-validated, internal explore API)

/**
 * Individual log entry from the logs dataset.
 * Fields match the Sentry Explore/Events API response for dataset=logs.
 */
export const SentryLogSchema = z
  .object({
    /** Unique identifier for deduplication */
    "sentry.item_id": z.string().describe("Unique log entry ID"),
    /** ISO timestamp of the log entry */
    timestamp: z.string().describe("Log timestamp (ISO 8601)"),
    /** Nanosecond-precision timestamp for accurate ordering and filtering.
     * Coerced from string because the API may return large integers as strings
     * to avoid precision loss beyond Number.MAX_SAFE_INTEGER. */
    timestamp_precise: z.coerce
      .number()
      .describe("Nanosecond-precision timestamp"),
    /** Log message content */
    message: z.string().nullable().optional().describe("Log message"),
    /** Log severity level (error, warning, info, debug, etc.) */
    severity: z
      .string()
      .nullable()
      .optional()
      .describe("Severity level (error, warning, info, debug)"),
    /** Trace ID for correlation with traces */
    trace: z
      .string()
      .nullable()
      .optional()
      .describe("Trace ID for correlation"),
  })
  .passthrough();

export type SentryLog = z.infer<typeof SentryLogSchema>;

/** Response from the logs events endpoint */
export const LogsResponseSchema = z.object({
  data: z.array(SentryLogSchema),
  meta: z
    .object({
      fields: z.record(z.string()).optional(),
    })
    .passthrough()
    .optional(),
});

export type LogsResponse = z.infer<typeof LogsResponseSchema>;

/**
 * Detailed log entry with all available fields from the logs dataset.
 * Used by the `log view` command for comprehensive log display.
 */
export const DetailedSentryLogSchema = z
  .object({
    /** Unique identifier for deduplication */
    "sentry.item_id": z.string(),
    /** ISO timestamp of the log entry */
    timestamp: z.string(),
    /** Nanosecond-precision timestamp for accurate ordering.
     * Coerced from string because the API may return large integers as strings
     * to avoid precision loss beyond Number.MAX_SAFE_INTEGER. */
    timestamp_precise: z.coerce.number(),
    /** Log message content */
    message: z.string().nullable().optional(),
    /** Log severity level (error, warning, info, debug, etc.) */
    severity: z.string().nullable().optional(),
    /** Trace ID for correlation with traces */
    trace: z.string().nullable().optional(),
    /** Project slug */
    project: z.string().nullable().optional(),
    /** Environment name */
    environment: z.string().nullable().optional(),
    /** Release version */
    release: z.string().nullable().optional(),
    /** SDK name */
    "sdk.name": z.string().nullable().optional(),
    /** SDK version */
    "sdk.version": z.string().nullable().optional(),
    /** Span ID for correlation with spans */
    span_id: z.string().nullable().optional(),
    /** Function name where log was emitted */
    "code.function": z.string().nullable().optional(),
    /** File path where log was emitted */
    "code.file.path": z.string().nullable().optional(),
    /** Line number where log was emitted */
    "code.line.number": z.string().nullable().optional(),
    /** OpenTelemetry span kind */
    "sentry.otel.kind": z.string().nullable().optional(),
    /** OpenTelemetry status code */
    "sentry.otel.status_code": z.string().nullable().optional(),
    /** OpenTelemetry instrumentation scope name */
    "sentry.otel.instrumentation_scope.name": z.string().nullable().optional(),
  })
  .passthrough();

export type DetailedSentryLog = z.infer<typeof DetailedSentryLogSchema>;

/** Response from the detailed log query endpoint */
export const DetailedLogsResponseSchema = z.object({
  data: z.array(DetailedSentryLogSchema),
  meta: z
    .object({
      fields: z.record(z.string()).optional(),
    })
    .passthrough()
    .optional(),
});

export type DetailedLogsResponse = z.infer<typeof DetailedLogsResponseSchema>;

// Trace-item detail types (from /projects/{org}/{project}/trace-items/{itemId}/ endpoint)

/**
 * A single attribute on a trace item (log, span, etc.).
 *
 * Mirrors Sentry's TraceItemResponseAttribute:
 * https://github.com/getsentry/sentry/blob/8a4f150b21b/static/app/views/explore/hooks/useTraceItemDetails.tsx#L85-L89
 *
 * The endpoint is EXPERIMENTAL and not yet in @sentry/api (getsentry/sentry-api-schema).
 */
export const TraceItemAttributeSchema = z.discriminatedUnion("type", [
  z.object({ name: z.string(), type: z.literal("str"), value: z.string() }),
  z.object({ name: z.string(), type: z.literal("int"), value: z.number() }),
  z.object({ name: z.string(), type: z.literal("float"), value: z.number() }),
  z.object({ name: z.string(), type: z.literal("bool"), value: z.boolean() }),
  // "array" is gated by organizations:trace-item-details-array-fields in Sentry backend
  z.object({
    name: z.string(),
    type: z.literal("array"),
    value: z.array(z.unknown()),
  }),
]);
export type TraceItemAttribute = z.infer<typeof TraceItemAttributeSchema>;

/** Response from GET /projects/{org}/{project}/trace-items/{itemId}/ (logs and spans) */
export const TraceItemDetailSchema = z
  .object({
    itemId: z.string(),
    timestamp: z.string(),
    attributes: z.array(TraceItemAttributeSchema),
  })
  .passthrough(); // preserves meta, links, and any future fields returned by the endpoint
export type TraceItemDetail = z.infer<typeof TraceItemDetailSchema>;

// Trace-log types (from /organizations/{org}/trace-logs/ endpoint)

/**
 * Individual log entry from the trace-logs endpoint.
 *
 * Fields returned by `GET /api/0/organizations/{org}/trace-logs/`. This endpoint
 * is org-scoped and always queries all projects — it returns a fixed set of 8
 * columns, unlike the flexible Explore/Events logs endpoint.
 *
 * Key differences from {@link SentryLog} (Explore/Events):
 * - `id` instead of `sentry.item_id`
 * - Includes `project.id` (integer) and `severity_number`
 * - `timestamp_precise` is a nanosecond integer (same as Explore/Events logs)
 */
export const TraceLogSchema = z
  .object({
    /** Unique identifier for this log entry */
    id: z.string(),
    /** Numeric ID of the project this log belongs to.
     * Coerced from string because some API responses return numeric IDs as strings. */
    "project.id": z.coerce.number(),
    /** The 32-character hex trace ID this log is associated with */
    trace: z.string(),
    /** Numeric OTel severity level (e.g., 9 = INFO, 13 = WARN, 17 = ERROR).
     * Optional because not all log entries include this field.
     * Coerced from string for resilience against API format variations. */
    severity_number: z.coerce.number().optional(),
    /** Severity label (e.g., "info", "warn", "error") */
    severity: z.string(),
    /** ISO 8601 timestamp */
    timestamp: z.string(),
    /** High-precision timestamp in nanoseconds.
     * Optional because some API responses may omit it.
     * Coerced from string because nanosecond timestamps (≈1.7e18 in 2026)
     * exceed Number.MAX_SAFE_INTEGER and APIs may return them as strings. */
    timestamp_precise: z.coerce.number().optional(),
    /** Log message content */
    message: z.string().nullable().optional(),
  })
  .passthrough();

export type TraceLog = z.infer<typeof TraceLogSchema>;

/** Response from the trace-logs endpoint */
export const TraceLogsResponseSchema = z
  .object({
    data: z.array(TraceLogSchema),
    meta: z
      .object({
        fields: z.record(z.string()).optional(),
        units: z.record(z.string()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type TraceLogsResponse = z.infer<typeof TraceLogsResponseSchema>;

// Transaction (for trace listing)

/**
 * Transaction list item from the Explore/Events API (dataset=transactions).
 * Fields match the response when querying trace, id, transaction, timestamp, etc.
 */
export const TransactionListItemSchema = z
  .object({
    /** Trace ID this transaction belongs to */
    trace: z.string().describe("Trace ID"),
    /** Event ID of the transaction */
    id: z.string().describe("Event ID"),
    /** Transaction name (e.g., "GET /api/users") */
    transaction: z.string().describe("Transaction name"),
    /** ISO timestamp of the transaction */
    timestamp: z.string().describe("Timestamp (ISO 8601)"),
    /** Transaction duration in milliseconds */
    "transaction.duration": z.number().describe("Duration (ms)"),
    /** Project slug */
    project: z.string().describe("Project slug"),
  })
  .passthrough();

export type TransactionListItem = z.infer<typeof TransactionListItemSchema>;

/** Response from the transactions events endpoint */
export const TransactionsResponseSchema = z.object({
  data: z.array(TransactionListItemSchema),
  meta: z
    .object({
      fields: z.record(z.string()).optional(),
    })
    .passthrough()
    .optional(),
});

export type TransactionsResponse = z.infer<typeof TransactionsResponseSchema>;

/** A single span item from the EAP spans search endpoint */
export const SpanListItemSchema = z
  .object({
    id: z.string().describe("Span ID"),
    parent_span: z.string().nullable().optional().describe("Parent span ID"),
    "span.op": z
      .string()
      .nullable()
      .optional()
      .describe("Span operation (e.g. http.client, db)"),
    description: z.string().nullable().optional().describe("Span description"),
    "span.duration": z.number().nullable().optional().describe("Duration (ms)"),
    timestamp: z.string().describe("Timestamp (ISO 8601)"),
    project: z.string().describe("Project slug"),
    transaction: z.string().nullable().optional().describe("Transaction name"),
    trace: z.string().describe("Trace ID"),
  })
  .passthrough();

export type SpanListItem = z.infer<typeof SpanListItemSchema>;

/** Response from the spans events endpoint */
export const SpansResponseSchema = z.object({
  data: z.array(SpanListItemSchema),
  meta: z
    .object({
      fields: z.record(z.string()).optional(),
    })
    .passthrough()
    .optional(),
});

export type SpansResponse = z.infer<typeof SpansResponseSchema>;

// Repository

/** Repository provider (e.g., GitHub, GitLab) */
export const RepositoryProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type RepositoryProvider = z.infer<typeof RepositoryProviderSchema>;

/** A repository connected to a Sentry organization */
export const SentryRepositorySchema = z
  .object({
    // Core identifiers (required)
    id: z.string().describe("Repository ID"),
    name: z.string().describe("Repository name"),
    url: z.string().nullable().describe("Repository URL"),
    provider: RepositoryProviderSchema.describe("Version control provider"),
    status: z.string().describe("Integration status"),
    // Optional metadata
    dateCreated: z.string().optional().describe("Creation date (ISO 8601)"),
    integrationId: z.string().optional().describe("Integration ID"),
    externalSlug: z
      .string()
      .nullable()
      .optional()
      .describe("External slug (e.g. org/repo)"),
    externalId: z.string().nullable().optional().describe("External ID"),
  })
  .passthrough();

export type SentryRepository = z.infer<typeof SentryRepositorySchema>;

// Cron Monitor

/**
 * Configuration of a cron monitor's expected schedule and thresholds.
 *
 * Returned by the `/organizations/{org}/monitors/` endpoint. The `schedule`
 * field is either a crontab string (when `schedule_type` is `"crontab"`) or a
 * `[value, unit]` tuple (when `"interval"`). Other fields are nullable because
 * the API returns `null` for unset thresholds.
 */
export const MonitorConfigSchema = z
  .object({
    schedule_type: z
      .string()
      .optional()
      .describe("Schedule type: 'crontab' or 'interval'"),
    schedule: z
      .union([z.string(), z.array(z.union([z.string(), z.number()]))])
      .optional()
      .describe("Crontab string or [value, unit] interval tuple"),
    timezone: z
      .string()
      .nullable()
      .optional()
      .describe("Schedule timezone (tz database string)"),
    checkin_margin: z
      .number()
      .nullable()
      .optional()
      .describe("Allowed minutes after the expected check-in time"),
    max_runtime: z
      .number()
      .nullable()
      .optional()
      .describe("Allowed minutes a check-in may run before timing out"),
    failure_issue_threshold: z
      .number()
      .nullable()
      .optional()
      .describe("Consecutive failures before an issue is created"),
    recovery_threshold: z
      .number()
      .nullable()
      .optional()
      .describe("Consecutive successes before an issue is resolved"),
  })
  .passthrough();

export type MonitorConfig = z.infer<typeof MonitorConfigSchema>;

/**
 * A cron monitor configured in a Sentry organization.
 *
 * Cron monitors are not modeled by the `@sentry/api` types this project
 * re-exports, so this is a hand-written internal schema (Pattern B). Core
 * identifiers (id, slug, name, status) are required; richer fields are widened
 * to optional and `.passthrough()` preserves any unmodeled API fields.
 */
export const SentryMonitorSchema = z
  .object({
    id: z.string().describe("Monitor ID"),
    slug: z.string().describe("Monitor slug"),
    name: z.string().describe("Monitor name"),
    status: z.string().describe("Monitor status (e.g. active, disabled)"),
    isMuted: z.boolean().optional().describe("Whether the monitor is muted"),
    config: MonitorConfigSchema.optional().describe("Schedule configuration"),
    dateCreated: z.string().optional().describe("Creation date (ISO 8601)"),
    project: z
      .object({
        id: z.string().optional().describe("Project ID"),
        slug: z.string().optional().describe("Project slug"),
        name: z.string().optional().describe("Project name"),
      })
      .passthrough()
      .optional()
      .describe("Owning project"),
  })
  .passthrough();

export type SentryMonitor = z.infer<typeof SentryMonitorSchema>;

// Team

/**
 * A team in a Sentry organization.
 *
 * Derived from the auto-generated `zBaseTeam` schema, picking only the
 * fields used in CLI output. All picked fields are widened to optional via
 * `.partial()`, then core identifiers (id, slug, name) are re-required.
 */
export const SentryTeamSchema = zBaseTeam
  .pick({
    id: true,
    slug: true,
    name: true,
    dateCreated: true,
    isMember: true,
    teamRole: true,
    memberCount: true,
  })
  .partial()
  .extend({
    id: z.string().describe("Team ID"),
    slug: z.string().describe("Team slug"),
    name: z.string().describe("Team name"),
    dateCreated: zBaseTeam.shape.dateCreated
      .optional()
      .describe("Creation date (ISO 8601)"),
    isMember: zBaseTeam.shape.isMember
      .optional()
      .describe("Whether you are a member"),
    teamRole: zBaseTeam.shape.teamRole
      .optional()
      .describe("Your role in the team"),
    memberCount: zBaseTeam.shape.memberCount
      .optional()
      .describe("Number of members"),
  })
  .passthrough();

/**
 * A Sentry team.
 *
 * Based on the `@sentry/api` `BaseTeam` type. Only core identifiers are
 * required; other SDK fields (dateCreated, isMember, teamRole, flags, access,
 * hasAccess, isPending, memberCount, avatar) are widened to optional so test
 * mocks and partial list-endpoint responses can omit them.
 *
 * `SentryTeamSchema` above is kept separately as the `--fields` / SKILL.md
 * documentation schema — it is NOT used for runtime validation (team list
 * responses are cast `as unknown as SentryTeam[]` in `api/teams.ts`), so the
 * schema and type are allowed to diverge: the schema curates a user-facing
 * subset of fields, the type follows the SDK's structural superset.
 */
export type SentryTeam = Partial<SdkTeam> & {
  id: string;
  slug: string;
  name: string;
};

// Product Trials

/** A product trial from the customer endpoint */
export const ProductTrialSchema = z.object({
  /** Trial category (e.g., "seerUsers", "seerAutofix") */
  category: z.string().describe("Trial category (e.g. seerUsers, seerAutofix)"),
  /** ISO date when the trial started, null if not started */
  startDate: z.string().nullable().describe("Start date (ISO 8601)"),
  /** ISO date when the trial ends, null if not started */
  endDate: z.string().nullable().describe("End date (ISO 8601)"),
  /** Reason code for the trial */
  reasonCode: z.number().describe("Reason code"),
  /** Whether the trial has been activated */
  isStarted: z.boolean().describe("Whether the trial has started"),
  /** Duration of the trial in days, null if unknown */
  lengthDays: z.number().nullable().describe("Trial duration in days"),
});

export type ProductTrial = z.infer<typeof ProductTrialSchema>;

/** Subset of plan details needed for plan trial display */
export const PlanDetailsSubsetSchema = z.object({
  /** Human-readable plan name (e.g., "Developer", "Business") */
  name: z.string(),
  /** Plan ID of the trial plan (e.g., "am3_t"), null if no trial plan */
  trialPlan: z.string().nullable().optional(),
});

/** Subset of customer data needed for trial availability checks */
export const CustomerTrialInfoSchema = z.object({
  /** Available and active product trials for the organization */
  productTrials: z.array(ProductTrialSchema).nullable().optional(),
  /** Whether the organization can start a plan-level trial */
  canTrial: z.boolean().optional(),
  /** Whether the organization is currently on a plan trial */
  isTrial: z.boolean().optional(),
  /** ISO date when the plan trial ends, null if not on trial */
  trialEnd: z.string().nullable().optional(),
  /** Plan details with trial plan info */
  planDetails: PlanDetailsSubsetSchema.optional(),
});

export type CustomerTrialInfo = z.infer<typeof CustomerTrialInfoSchema>;
