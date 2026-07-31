import { z } from "zod";

export type ReplayTags = Record<string, string[]>;

/**
 * User geo metadata attached to a replay.
 */
export const ReplayGeoSchema = z
  .object({
    city: z.string().nullish().describe("City"),
    country_code: z.string().nullish().describe("Country code"),
    region: z.string().nullish().describe("Region"),
    subdivision: z.string().nullish().describe("Subdivision"),
  })
  .passthrough();

/**
 * User metadata attached to a replay.
 */
export const ReplayUserSchema = z
  .object({
    id: z.string().nullish().describe("User ID"),
    username: z.string().nullish().describe("Username"),
    email: z.string().nullish().describe("Email"),
    ip: z.string().nullish().describe("IP address"),
    display_name: z.string().nullish().describe("Display name"),
    geo: ReplayGeoSchema.nullish().describe("Geo metadata"),
  })
  .passthrough();

/**
 * Browser metadata attached to a replay.
 */
export const ReplayBrowserSchema = z
  .object({
    name: z.string().nullish().describe("Browser name"),
    version: z.string().nullish().describe("Browser version"),
  })
  .passthrough();

/**
 * Operating system metadata attached to a replay.
 */
export const ReplayOsSchema = z
  .object({
    name: z.string().nullish().describe("OS name"),
    version: z.string().nullish().describe("OS version"),
  })
  .passthrough();

/**
 * SDK metadata attached to a replay.
 */
export const ReplaySdkSchema = z
  .object({
    name: z.string().nullish().describe("SDK name"),
    version: z.string().nullish().describe("SDK version"),
  })
  .passthrough();

/**
 * Device metadata attached to a replay.
 */
export const ReplayDeviceSchema = z
  .object({
    brand: z.string().nullish().describe("Device brand"),
    family: z.string().nullish().describe("Device family"),
    model: z.string().nullish().describe("Device model"),
    model_id: z.string().nullish().describe("Device model identifier"),
    name: z.string().nullish().describe("Device name"),
  })
  .passthrough();

/**
 * OTA update metadata attached to a replay.
 */
export const ReplayOtaUpdatesSchema = z
  .object({
    channel: z.string().nullish().describe("OTA update channel"),
    runtime_version: z.string().nullish().describe("OTA runtime version"),
    update_id: z.string().nullish().describe("OTA update ID"),
  })
  .passthrough();

/**
 * Replay tags keyed by tag name.
 *
 * Archived replay rows sometimes return an empty array instead of a tag map,
 * so the schema falls back to an empty tag object for those placeholders.
 */
export const ReplayTagsSchema = z
  .record(z.array(z.string()))
  .catch({})
  .describe("Replay tags") as z.ZodType<ReplayTags>;

/**
 * Known root fields that the replay list endpoint accepts in repeated `field=`
 * query params.
 *
 * These are intentionally the root field names expected by the backend
 * validator, not dotted nested field names.
 */
export const REPLAY_LIST_FIELDS = [
  "activity",
  "browser",
  "count_dead_clicks",
  "count_errors",
  "count_infos",
  "count_rage_clicks",
  "count_segments",
  "count_urls",
  "count_warnings",
  "device",
  "dist",
  "duration",
  "environment",
  "error_ids",
  "finished_at",
  "has_viewed",
  "id",
  "info_ids",
  "is_archived",
  "os",
  "platform",
  "project_id",
  "releases",
  "sdk",
  "started_at",
  "tags",
  "trace_ids",
  "urls",
  "user",
  "warning_ids",
] as const;

function replayNullableNumber(description: string) {
  return z.number().nullable().optional().describe(description);
}

function replayNullableString(description: string) {
  return z.string().nullable().optional().describe(description);
}

function replayNullableBoolean(description: string) {
  return z.boolean().nullable().optional().describe(description);
}

function replayNullishObject<T extends z.ZodTypeAny>(
  schema: T,
  description: string
) {
  return schema.nullish().describe(description);
}

function replayStringArray() {
  return z.array(z.string());
}

function replayStringArrayWithFallback() {
  return replayStringArray().catch([]);
}

function buildReplayListItemShape<
  TErrorIds extends z.ZodTypeAny,
  TInfoIds extends z.ZodTypeAny,
  TOtaUpdates extends z.ZodTypeAny,
  TProjectId extends z.ZodTypeAny,
  TReleases extends z.ZodTypeAny,
  TTags extends z.ZodTypeAny,
  TTraceIds extends z.ZodTypeAny,
  TUrls extends z.ZodTypeAny,
  TWarningIds extends z.ZodTypeAny,
>(fields: {
  errorIds: TErrorIds;
  infoIds: TInfoIds;
  otaUpdates: TOtaUpdates;
  projectId: TProjectId;
  releases: TReleases;
  tags: TTags;
  traceIds: TTraceIds;
  urls: TUrls;
  warningIds: TWarningIds;
}) {
  return {
    activity: replayNullableNumber("Replay activity score"),
    browser: replayNullishObject(ReplayBrowserSchema, "Browser metadata"),
    count_dead_clicks: replayNullableNumber("Dead click count"),
    count_errors: replayNullableNumber("Associated error count"),
    count_infos: replayNullableNumber("Info event count"),
    count_rage_clicks: replayNullableNumber("Rage click count"),
    count_segments: replayNullableNumber("Recording segment count"),
    count_urls: replayNullableNumber("Visited URL count"),
    count_warnings: replayNullableNumber("Warning event count"),
    device: replayNullishObject(ReplayDeviceSchema, "Device metadata"),
    dist: replayNullableString("Distribution"),
    duration: replayNullableNumber("Replay duration in seconds"),
    environment: replayNullableString("Environment"),
    error_ids: fields.errorIds.describe("Linked error IDs"),
    finished_at: replayNullableString("Replay finish timestamp"),
    has_viewed: replayNullableBoolean(
      "Whether the current user has viewed the replay"
    ),
    id: z.string().describe("Replay ID"),
    info_ids: fields.infoIds.describe("Linked info event IDs"),
    is_archived: replayNullableBoolean("Archived flag"),
    os: replayNullishObject(ReplayOsSchema, "Operating system metadata"),
    ota_updates: fields.otaUpdates.describe("OTA update metadata"),
    platform: replayNullableString("Platform"),
    project_id: fields.projectId.describe("Numeric project ID"),
    releases: fields.releases.describe("Associated releases"),
    sdk: replayNullishObject(ReplaySdkSchema, "SDK metadata"),
    started_at: replayNullableString("Replay start timestamp"),
    tags: fields.tags.describe("Replay tags"),
    trace_ids: fields.traceIds.describe("Linked trace IDs"),
    urls: fields.urls.describe("Visited URLs"),
    user: replayNullishObject(ReplayUserSchema, "User metadata"),
    warning_ids: fields.warningIds.describe("Linked warning event IDs"),
  };
}

/**
 * A single replay row returned by the organization replay index endpoint.
 *
 * Duration is in seconds, matching the backend replay interchange format.
 */
export const ReplayListItemSchema = z
  .object(
    buildReplayListItemShape({
      errorIds: replayStringArrayWithFallback(),
      infoIds: replayStringArrayWithFallback(),
      otaUpdates: replayNullishObject(
        ReplayOtaUpdatesSchema,
        "OTA update metadata"
      ),
      projectId: z.union([z.string(), z.number()]).nullable().optional(),
      releases: replayStringArrayWithFallback(),
      tags: ReplayTagsSchema,
      traceIds: replayStringArrayWithFallback(),
      urls: replayStringArrayWithFallback(),
      warningIds: replayStringArrayWithFallback(),
    })
  )
  .passthrough()
  .describe("Replay list row");

/**
 * Click selector summaries attached to replay detail responses.
 */
export const ReplayClickSchema = z
  .record(z.unknown())
  .describe("Replay click selector summary");

/**
 * Full replay metadata returned by the replay detail endpoint.
 */
export const ReplayDetailsSchema = ReplayListItemSchema.extend({
  clicks: z
    .array(ReplayClickSchema)
    .optional()
    .describe("Replay click summaries"),
  replay_type: z.string().nullable().optional().describe("Replay type"),
}).describe("Replay details");

/** Envelope returned by the replay index endpoint. */
export const ReplayListResponseSchema = z
  .object({
    data: z.array(ReplayListItemSchema),
  })
  .passthrough();

/** Envelope returned by the replay detail endpoint. */
export const ReplayDetailsResponseSchema = z
  .object({
    data: ReplayDetailsSchema,
  })
  .passthrough();

/**
 * Documentation-oriented replay list schema used for `--help` and SKILL docs.
 *
 * Keeps the field types explicit even though the runtime parser accepts a few
 * legacy/nullish payload variants from archived replay rows.
 */
export const ReplayListItemOutputSchema = z
  .object(
    buildReplayListItemShape({
      errorIds: replayStringArray(),
      infoIds: replayStringArray(),
      otaUpdates: ReplayOtaUpdatesSchema.nullish(),
      projectId: z.string().nullable().optional(),
      releases: replayStringArray(),
      tags: z.record(z.array(z.string())),
      traceIds: replayStringArray(),
      urls: replayStringArray(),
      warningIds: replayStringArray(),
    })
  )
  .describe("Replay list row");

/** Documentation-oriented replay detail schema used for command metadata. */
export const ReplayDetailsOutputSchema = ReplayListItemOutputSchema.extend({
  clicks: z
    .array(ReplayClickSchema)
    .optional()
    .describe("Replay click summaries"),
  replay_type: z.string().nullable().optional().describe("Replay type"),
}).describe("Replay details");

/** A summarized replay activity event extracted from recording segments. */
export const ReplayActivityEventSchema = z
  .object({
    timestampMs: z
      .number()
      .nullable()
      .describe("Milliseconds since UNIX epoch for the activity event"),
    label: z.string().describe("Activity label"),
    details: z.array(z.string()).describe("Supplemental activity details"),
  })
  .describe("Summarized replay activity event");

/** Related issue metadata extracted from replay-linked event IDs. */
export const ReplayRelatedIssueSchema = z
  .object({
    eventId: z.string().describe("Replay-linked event ID"),
    issueId: z.string().nullable().optional().describe("Resolved issue ID"),
    shortId: z
      .string()
      .nullable()
      .optional()
      .describe("Resolved issue short ID"),
    title: z.string().nullable().optional().describe("Resolved issue title"),
  })
  .describe("Replay-related issue");

/** Related trace metadata extracted from replay trace IDs. */
export const ReplayRelatedTraceSchema = z
  .object({
    traceId: z.string().describe("Replay-linked trace ID"),
    errorCount: z.number().nullable().optional().describe("Trace error count"),
    logCount: z.number().nullable().optional().describe("Trace log count"),
    performanceIssueCount: z
      .number()
      .nullable()
      .optional()
      .describe("Trace performance issue count"),
    spanCount: z.number().nullable().optional().describe("Trace span count"),
  })
  .describe("Replay-related trace");

/** Replay view output with related context and summarized activity. */
export const ReplayViewOutputSchema = ReplayDetailsOutputSchema.extend({
  org: z.string().describe("Organization slug"),
  activity: z
    .array(ReplayActivityEventSchema)
    .describe("Summarized replay activity"),
  relatedIssues: z
    .array(ReplayRelatedIssueSchema)
    .describe("Replay-related issues"),
  relatedTraces: z
    .array(ReplayRelatedTraceSchema)
    .describe("Replay-related traces"),
}).describe("Replay view output");

/** Replay IDs keyed by resource identifier (issue ID, trace ID, replay ID). */
export const ReplayIdsByResourceSchema = z
  .record(z.string(), z.array(z.string()))
  .describe("Replay IDs grouped by resource identifier");

export type ReplayGeo = z.infer<typeof ReplayGeoSchema>;
export type ReplayUser = z.infer<typeof ReplayUserSchema>;
export type ReplayBrowser = z.infer<typeof ReplayBrowserSchema>;
export type ReplayOs = z.infer<typeof ReplayOsSchema>;
export type ReplaySdk = z.infer<typeof ReplaySdkSchema>;
export type ReplayDevice = z.infer<typeof ReplayDeviceSchema>;
export type ReplayOtaUpdates = z.infer<typeof ReplayOtaUpdatesSchema>;
export type ReplayListItem = z.infer<typeof ReplayListItemSchema>;
export type ReplayDetails = z.infer<typeof ReplayDetailsSchema>;
export type ReplayListResponse = z.infer<typeof ReplayListResponseSchema>;
export type ReplayDetailsResponse = z.infer<typeof ReplayDetailsResponseSchema>;
export type ReplayIdsByResource = z.infer<typeof ReplayIdsByResourceSchema>;
export type ReplayActivityEvent = z.infer<typeof ReplayActivityEventSchema>;
export type ReplayRelatedIssue = z.infer<typeof ReplayRelatedIssueSchema>;
export type ReplayRelatedTrace = z.infer<typeof ReplayRelatedTraceSchema>;
