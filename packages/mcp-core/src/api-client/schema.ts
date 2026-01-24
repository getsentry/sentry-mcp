/**
 * Zod schemas for Sentry API response validation.
 *
 * This module contains comprehensive Zod schemas that validate and type-check
 * responses from Sentry's REST API. All schemas are designed to handle Sentry's
 * flexible data model where most fields can be null or optional.
 *
 * Key Design Principles:
 * - Use .passthrough() for objects that may contain additional fields
 * - Support both string and number IDs (Sentry's legacy/modern ID formats)
 * - Handle nullable fields gracefully throughout the schema hierarchy
 * - Use union types for polymorphic data (events, assignedTo, etc.)
 *
 * Schema Categories:
 * - **Core Resources**: Users, Organizations, Teams, Projects
 * - **Issue Management**: Issues, Events, Assignments
 * - **Release Management**: Releases, Commits, Deployments
 * - **Search & Discovery**: Tags, Error Search, Span Search
 * - **Integrations**: Client Keys (DSNs), Autofix
 *
 * @example Schema Usage
 * ```typescript
 * import { IssueListSchema } from "./schema";
 *
 * const response = await fetch("/api/0/organizations/my-org/issues/");
 * const issues = IssueListSchema.parse(await response.json());
 * // TypeScript now knows the exact shape of issues
 * ```
 *
 * @example Error Handling
 * ```typescript
 * const { data, success, error } = ApiErrorSchema.safeParse(response);
 * if (success) {
 *   throw new ApiError(data.detail, statusCode);
 * }
 * ```
 */
import { z } from "zod";

/**
 * Schema for Sentry API error responses.
 *
 * Uses .passthrough() to allow additional fields that may be present
 * in different error scenarios.
 */
export const ApiErrorSchema = z
  .object({
    detail: z.string(),
  })
  .passthrough();

export const UserSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    name: z.string().nullable(),
    email: z.string(),
  })
  .passthrough();

export const UserRegionsSchema = z.object({
  regions: z.array(
    z.object({
      name: z.string(),
      url: z.string().url(),
    }),
  ),
});

/**
 * Schema for Sentry organization API responses.
 *
 * Handles organizations from both Sentry's Cloud Service and self-hosted installations.
 * The links object and regionUrl field are optional to support self-hosted Sentry
 * instances that may not include these fields or return empty values.
 */
export const OrganizationSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    slug: z.string(),
    name: z.string(),
    links: z
      .object({
        regionUrl: z
          .string()
          .refine(
            (value) => !value || z.string().url().safeParse(value).success,
            {
              message:
                "Must be a valid URL or empty string (for self-hosted Sentry)",
            },
          )
          .optional(),
        organizationUrl: z.string().url(),
      })
      .optional(),
  })
  .passthrough();

export const OrganizationListSchema = z.array(OrganizationSchema);

export const TeamSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    slug: z.string(),
    name: z.string(),
  })
  .passthrough();

export const TeamListSchema = z.array(TeamSchema);

export const ProjectSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    slug: z.string(),
    name: z.string(),
    platform: z.string().nullable().optional(),
    hasProfiles: z.boolean().optional(),
    hasReplays: z.boolean().optional(),
    hasLogs: z.boolean().optional(),
    firstTransactionEvent: z.boolean().optional(),
  })
  .passthrough();

export const ProjectListSchema = z.array(ProjectSchema);

export const ClientKeySchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    name: z.string(),
    dsn: z.object({
      public: z.string(),
    }),
    isActive: z.boolean(),
    dateCreated: z.string().datetime(),
  })
  .passthrough();

export const ClientKeyListSchema = z.array(ClientKeySchema);

export const ReleaseSchema = z.object({
  id: z.union([z.string(), z.number()]),
  version: z.string(),
  shortVersion: z.string(),
  dateCreated: z.string().datetime(),
  dateReleased: z.string().datetime().nullable(),
  firstEvent: z.string().datetime().nullable(),
  lastEvent: z.string().datetime().nullable(),
  newGroups: z.number(),
  lastCommit: z
    .object({
      id: z.union([z.string(), z.number()]),
      message: z.string(),
      dateCreated: z.string().datetime(),
      author: z.object({
        name: z.string(),
        email: z.string(),
      }),
    })
    .nullable(),
  lastDeploy: z
    .object({
      id: z.union([z.string(), z.number()]),
      environment: z.string(),
      dateStarted: z.string().datetime().nullable(),
      dateFinished: z.string().datetime().nullable(),
    })
    .nullable(),
  projects: z.array(ProjectSchema),
});

export const ReleaseListSchema = z.array(ReleaseSchema);

export const TagSchema = z.object({
  key: z.string(),
  name: z.string(),
  totalValues: z.number(),
});

export const TagListSchema = z.array(TagSchema);

// Schema for assignedTo field - can be a user object, team object, string, or null
export const AssignedToSchema = z.union([
  z.null(),
  z.string(), // username or actor ID
  z
    .object({
      type: z.enum(["user", "team"]),
      id: z.union([z.string(), z.number()]),
      name: z.string(),
      email: z.string().optional(), // only for users
    })
    .passthrough(), // Allow additional fields we might not know about
]);

export const IssueSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    shortId: z.string(),
    title: z.string(),
    firstSeen: z.string().datetime(),
    lastSeen: z.string().datetime(),
    count: z.union([z.string(), z.number()]),
    userCount: z.union([z.string(), z.number()]),
    permalink: z.string().url(),
    project: ProjectSchema,
    platform: z.string().nullable().optional(),
    status: z.string(),
    substatus: z.string().nullable().optional(),
    culprit: z.string(),
    type: z.union([
      z.literal("error"),
      z.literal("transaction"),
      z.literal("generic"),
      z.unknown(),
    ]),
    assignedTo: AssignedToSchema.optional(),
    issueType: z.string().optional(),
    issueCategory: z.string().optional(),
    metadata: z
      .object({
        title: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        value: z.string().nullable().optional(),
      })
      .optional(),
    seerFixabilityScore: z.number().nullable().optional(),
  })
  .passthrough();

export const IssueListSchema = z.array(IssueSchema);

export const FrameInterface = z
  .object({
    filename: z.string().nullable(),
    function: z.string().nullable(),
    lineNo: z.number().nullable(),
    colNo: z.number().nullable(),
    absPath: z.string().nullable(),
    module: z.string().nullable(),
    // lineno, source code
    context: z.array(z.tuple([z.number(), z.string()])),
    inApp: z.boolean().optional(),
    vars: z.record(z.string(), z.unknown()).optional(),
  })
  .partial();

// XXX: Sentry's schema generally speaking is "assume all user input is missing"
// so we need to handle effectively every field being optional or nullable.
export const ExceptionInterface = z
  .object({
    mechanism: z
      .object({
        type: z.string().nullable(),
        handled: z.boolean().nullable(),
      })
      .partial(),
    type: z.string().nullable(),
    value: z.string().nullable(),
    stacktrace: z.object({
      frames: z.array(FrameInterface),
    }),
  })
  .partial();

export const ErrorEntrySchema = z
  .object({
    // XXX: Sentry can return either of these. Not sure why we never normalized it.
    values: z.array(ExceptionInterface.optional()),
    value: ExceptionInterface.nullable().optional(),
  })
  .partial();

export const RequestEntrySchema = z
  .object({
    method: z.string().nullable(),
    url: z.string().url().nullable(),
    // TODO:
    // query: z.array(z.tuple([z.string(), z.string()])).nullable(),
    // data: z.unknown().nullable(),
    // headers: z.array(z.tuple([z.string(), z.string()])).nullable(),
  })
  .partial();

export const MessageEntrySchema = z
  .object({
    formatted: z.string().nullable(),
    message: z.string().nullable(),
    params: z.array(z.unknown()).optional(),
  })
  .partial();

export const ThreadEntrySchema = z
  .object({
    id: z.number().nullable(),
    name: z.string().nullable(),
    current: z.boolean().nullable(),
    crashed: z.boolean().nullable(),
    state: z.string().nullable(),
    stacktrace: z
      .object({
        frames: z.array(FrameInterface),
      })
      .nullable(),
  })
  .partial();

export const ThreadsEntrySchema = z
  .object({
    values: z.array(ThreadEntrySchema),
  })
  .partial();

export const BreadcrumbSchema = z
  .object({
    timestamp: z.string().nullable(),
    type: z.string().nullable(),
    category: z.string().nullable(),
    level: z.string().nullable(),
    message: z.string().nullable(),
    data: z.record(z.unknown()).nullable(),
  })
  .partial();

export const BreadcrumbsEntrySchema = z
  .object({
    values: z.array(BreadcrumbSchema),
  })
  .partial();

const BaseEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  message: z.string().nullable(),
  platform: z.string().nullable().optional(),
  type: z.unknown(),
  entries: z.array(
    z.union([
      z.object({
        type: z.literal("exception"),
        data: ErrorEntrySchema,
      }),
      z.object({
        type: z.literal("message"),
        data: MessageEntrySchema,
      }),
      z.object({
        type: z.literal("threads"),
        data: ThreadsEntrySchema,
      }),
      z.object({
        type: z.literal("request"),
        data: RequestEntrySchema,
      }),
      z.object({
        type: z.literal("breadcrumbs"),
        data: BreadcrumbsEntrySchema,
      }),
      z.object({
        type: z.literal("spans"),
        data: z.unknown(),
      }),
      z.object({
        type: z.string(),
        data: z.unknown(),
      }),
    ]),
  ),
  contexts: z
    .record(
      z.string(),
      z
        .object({
          type: z.union([
            z.literal("default"),
            z.literal("runtime"),
            z.literal("os"),
            z.literal("trace"),
            z.unknown(),
          ]),
        })
        .passthrough(),
    )
    .optional(),
  // "context" (singular) is the legacy "extra" field for arbitrary user-defined data
  // This is different from "contexts" (plural) which are structured contexts
  context: z.record(z.string(), z.unknown()).optional(),
  tags: z
    .array(
      z.object({
        key: z.string(),
        value: z.string().nullable(),
      }),
    )
    .optional(),
  // The _meta field contains metadata about fields in the response
  // It's safer to type as unknown since its structure varies
  _meta: z.unknown().optional(),
  // dateReceived is when the server received the event (may not be present in all contexts)
  dateReceived: z.string().datetime().optional(),
});

export const ErrorEventSchema = BaseEventSchema.omit({
  type: true,
}).extend({
  type: z.literal("error"),
  culprit: z.string().nullable(),
  dateCreated: z.string().datetime(),
});

export const DefaultEventSchema = BaseEventSchema.omit({
  type: true,
}).extend({
  type: z.literal("default"),
  culprit: z.string().nullable().optional(),
  dateCreated: z.string().datetime(),
});

export const TransactionEventSchema = BaseEventSchema.omit({
  type: true,
}).extend({
  type: z.literal("transaction"),
  occurrence: z
    .object({
      id: z.string().optional(),
      projectId: z.number().optional(),
      eventId: z.string().optional(),
      fingerprint: z.array(z.string()).optional(),
      issueTitle: z.string(),
      subtitle: z.string().optional(),
      resourceId: z.string().nullable().optional(),
      evidenceData: z.record(z.string(), z.any()).optional(),
      evidenceDisplay: z
        .array(
          z.object({
            name: z.string(),
            value: z.string(),
            important: z.boolean().optional(),
          }),
        )
        .optional(),
      type: z.number().optional(),
      detectionTime: z.number().optional(),
      level: z.string().optional(),
      culprit: z.string().nullable(),
      priority: z.number().optional(),
      assignee: z.string().nullable().optional(),
    })
    .nullish(), // Allow both null and undefined
});

/**
 * Schema for evidence display items in occurrence data.
 * These show regression details, metric changes, and other evidence.
 */
export const EvidenceDisplaySchema = z.object({
  name: z.string(),
  value: z.string(),
  important: z.boolean(),
});

/**
 * Schema for occurrence data in generic events.
 * Occurrences represent performance regressions and metric-based issues.
 */
export const OccurrenceSchema = z
  .object({
    id: z.string(),
    projectId: z.number(),
    eventId: z.string(),
    fingerprint: z.array(z.string()),
    issueTitle: z.string(),
    subtitle: z.string().optional(),
    resourceId: z.string().nullable().optional(),
    evidenceData: z.record(z.string(), z.unknown()).optional(),
    evidenceDisplay: z.array(EvidenceDisplaySchema).optional(),
    type: z.number(),
    detectionTime: z.number().optional(),
    level: z.string().optional(),
    culprit: z.string().optional(),
    priority: z.number().optional(),
    assignee: z.string().nullable().optional(),
  })
  .passthrough();

export const GenericEventSchema = BaseEventSchema.omit({
  type: true,
}).extend({
  type: z.literal("generic"),
  culprit: z.string().nullable().optional(),
  dateCreated: z.string().datetime(),
  occurrence: OccurrenceSchema.optional(),
});

export const UnknownEventSchema = BaseEventSchema.omit({
  type: true,
}).extend({
  type: z.unknown(),
});

// XXX: This API response is kind of a disaster. We are not propagating the appropriate
// columns and it makes this really hard to work with. Errors and Transaction-based issues
// are completely different, for example.
export const EventSchema = z.union([
  ErrorEventSchema,
  DefaultEventSchema,
  TransactionEventSchema,
  GenericEventSchema,
  UnknownEventSchema,
]);

export const EventsResponseSchema = z.object({
  data: z.array(z.unknown()),
  meta: z
    .object({
      fields: z.record(z.string(), z.string()),
    })
    .passthrough(),
});

// https://us.sentry.io/api/0/organizations/sentry/events/?dataset=errors&field=issue&field=title&field=project&field=timestamp&field=trace&per_page=5&query=event.type%3Aerror&referrer=sentry-mcp&sort=-timestamp&statsPeriod=1w
export const ErrorsSearchResponseSchema = EventsResponseSchema.extend({
  data: z.array(
    z.object({
      issue: z.string(),
      "issue.id": z.union([z.string(), z.number()]),
      project: z.string(),
      title: z.string(),
      "count()": z.number(),
      "last_seen()": z.string(),
    }),
  ),
});

export const SpansSearchResponseSchema = EventsResponseSchema.extend({
  data: z.array(
    z.object({
      id: z.string(),
      trace: z.string(),
      "span.op": z.string(),
      "span.description": z.string(),
      "span.duration": z.number(),
      transaction: z.string(),
      project: z.string(),
      timestamp: z.string(),
    }),
  ),
});

export const AutofixRunSchema = z
  .object({
    run_id: z.union([z.string(), z.number()]),
  })
  .passthrough();

const AutofixStatusSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "IN_PROGRESS",
  "NEED_MORE_INFORMATION",
  "COMPLETED",
  "FAILED",
  "ERROR",
  "CANCELLED",
  "WAITING_FOR_USER_RESPONSE",
]);

const AutofixRunStepBaseSchema = z.object({
  type: z.string(),
  key: z.string(),
  index: z.number(),
  status: AutofixStatusSchema,
  title: z.string(),
  output_stream: z.string().nullable(),
  progress: z.array(
    z.object({
      data: z.unknown().nullable(),
      message: z.string(),
      timestamp: z.string(),
      type: z.enum(["INFO", "WARNING", "ERROR"]),
    }),
  ),
});

export const AutofixRunStepDefaultSchema = AutofixRunStepBaseSchema.extend({
  type: z.literal("default"),
  insights: z
    .array(
      z.object({
        change_diff: z.unknown().nullable(),
        generated_at_memory_index: z.number(),
        insight: z.string(),
        justification: z.string(),
        type: z.literal("insight"),
      }),
    )
    .nullable(),
}).passthrough();

export const AutofixRunStepRootCauseAnalysisSchema =
  AutofixRunStepBaseSchema.extend({
    type: z.literal("root_cause_analysis"),
    causes: z.array(
      z.object({
        description: z.string(),
        id: z.number(),
        root_cause_reproduction: z.array(
          z.object({
            code_snippet_and_analysis: z.string(),
            is_most_important_event: z.boolean(),
            relevant_code_file: z
              .object({
                file_path: z.string(),
                repo_name: z.string(),
              })
              .nullable(),
            timeline_item_type: z.string(),
            title: z.string(),
          }),
        ),
      }),
    ),
  }).passthrough();

export const AutofixRunStepSolutionSchema = AutofixRunStepBaseSchema.extend({
  type: z.literal("solution"),
  solution: z.array(
    z.object({
      code_snippet_and_analysis: z.string().nullable(),
      is_active: z.boolean(),
      is_most_important_event: z.boolean(),
      relevant_code_file: z.null(),
      timeline_item_type: z.union([
        z.literal("internal_code"),
        z.literal("repro_test"),
      ]),
      title: z.string(),
    }),
  ),
}).passthrough();

export const AutofixRunStepSchema = z.union([
  AutofixRunStepDefaultSchema,
  AutofixRunStepRootCauseAnalysisSchema,
  AutofixRunStepSolutionSchema,
  AutofixRunStepBaseSchema.passthrough(),
]);

export const AutofixRunStateSchema = z.object({
  autofix: z
    .object({
      run_id: z.number(),
      request: z.unknown(),
      updated_at: z.string(),
      status: AutofixStatusSchema,
      steps: z.array(AutofixRunStepSchema),
    })
    .passthrough()
    .nullable(),
});

export const EventAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number(),
  mimetype: z.string(),
  dateCreated: z.string().datetime(),
  sha1: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const EventAttachmentListSchema = z.array(EventAttachmentSchema);

/**
 * Schema for individual tag values within an issue's tag distribution.
 *
 * Represents a single value's occurrence count and percentage within a tag.
 */
export const IssueTagValueSchema = z.object({
  key: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  value: z.string().nullable(),
  count: z.number(),
  lastSeen: z.string().datetime().nullable().optional(),
  firstSeen: z.string().datetime().nullable().optional(),
});

/**
 * Schema for Sentry issue tag values response.
 *
 * Contains aggregate counts of unique tag values for an issue,
 * useful for understanding the distribution of tags like URL, browser, etc.
 */
export const IssueTagValuesSchema = z.object({
  key: z.string(),
  name: z.string(),
  totalValues: z.number(),
  topValues: z.array(IssueTagValueSchema),
});

/**
 * Schema for Sentry trace metadata response.
 *
 * Contains high-level statistics about a trace including span counts,
 * transaction breakdown, and operation type distribution.
 */
export const TraceMetaSchema = z.object({
  logs: z.number(),
  errors: z.number(),
  performance_issues: z.number(),
  span_count: z.number(),
  transaction_child_count_map: z.array(
    z.object({
      "transaction.event_id": z.string().nullable(),
      "count()": z.number(),
    }),
  ),
  span_count_map: z.record(z.string(), z.number()),
});

/**
 * Schema for individual spans within a trace.
 *
 * Represents the hierarchical structure of spans with timing information,
 * operation details, and nested children spans.
 */
export const TraceSpanSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    children: z.array(TraceSpanSchema),
    errors: z.array(z.any()),
    occurrences: z.array(z.any()),
    event_id: z.string(),
    transaction_id: z.string(),
    project_id: z.union([z.string(), z.number()]),
    project_slug: z.string(),
    profile_id: z.string(),
    profiler_id: z.string(),
    parent_span_id: z.string().nullable(),
    start_timestamp: z.number(),
    end_timestamp: z.number(),
    measurements: z.record(z.string(), z.number()).optional(),
    duration: z.number(),
    transaction: z.string(),
    is_transaction: z.boolean(),
    description: z.string(),
    sdk_name: z.string(),
    op: z.string(),
    name: z.string(),
    event_type: z.string(),
    additional_attributes: z.record(z.string(), z.any()),
  }),
);

/**
 * Schema for issue objects that can appear in trace responses.
 *
 * When Sentry's trace API returns standalone errors, they are returned as
 * SerializedIssue objects that lack the span-specific fields.
 */
export const TraceIssueSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    issue_id: z.union([z.string(), z.number()]).optional(),
    project_id: z.union([z.string(), z.number()]).optional(),
    project_slug: z.string().optional(),
    title: z.string().optional(),
    culprit: z.string().optional(),
    type: z.string().optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

/**
 * Schema for Sentry trace response.
 *
 * Contains the complete trace tree starting from root spans.
 * The response is an array that can contain both root-level spans
 * and standalone issue objects. The Sentry API's query_trace_data
 * function returns a mixed list of SerializedSpan and SerializedIssue
 * objects when there are errors not directly associated with spans.
 */
export const TraceSchema = z.array(
  z.union([TraceSpanSchema, TraceIssueSchema]),
);

/**
 * Schema for individual frames in a flamegraph.
 *
 * Represents a single stack frame with file/function information and
 * whether it's application code or library code.
 */
export const FlamegraphFrameSchema = z
  .object({
    file: z.string(),
    image: z.string().optional(),
    is_application: z.boolean(),
    line: z.number(),
    name: z.string(),
    path: z.string().optional(),
    fingerprint: z.number(),
  })
  .passthrough();

/**
 * Schema for aggregated performance statistics for a single frame.
 *
 * Contains sample counts, total weight/duration, and performance percentiles
 * (p75, p95, p99) for the frame across all samples.
 */
export const FlamegraphFrameInfoSchema = z
  .object({
    count: z.number(),
    weight: z.number(),
    sumDuration: z.number(),
    sumSelfTime: z.number(),
    p75Duration: z.number(),
    p95Duration: z.number(),
    p99Duration: z.number(),
  })
  .passthrough();

/**
 * Schema for profile metadata within a flamegraph response.
 *
 * Links to individual profile IDs and their time ranges.
 */
export const FlamegraphProfileMetadataSchema = z
  .object({
    project_id: z.number(),
    profile_id: z.string(),
    start: z.number(),
    end: z.number(),
  })
  .passthrough();

/**
 * Schema for a single profile within a flamegraph (typically one per thread).
 *
 * Contains arrays of samples (call stack patterns), their occurrence counts,
 * durations, and relative weights.
 */
export const FlamegraphProfileSchema = z
  .object({
    endValue: z.number(),
    isMainThread: z.boolean(),
    name: z.string(),
    samples: z.array(z.array(z.number())), // Arrays of frame indices
    startValue: z.number(),
    threadID: z.number(),
    type: z.string(),
    unit: z.string(),
    weights: z.array(z.number()),
    sample_durations_ns: z.array(z.number()),
    sample_counts: z.array(z.number()),
  })
  .passthrough();

/**
 * Schema for flamegraph API response.
 *
 * Flamegraphs provide pre-aggregated CPU profiling data with:
 * - Unique call stack patterns (samples)
 * - Performance statistics (counts, durations, percentiles)
 * - Frame metadata (file, function, is_application)
 *
 * This is the primary data source for profile analysis as it's
 * already aggregated and includes percentile calculations.
 */
export const FlamegraphSchema = z
  .object({
    activeProfileIndex: z.number(),
    metadata: z.record(z.unknown()).optional(),
    platform: z.string(),
    profiles: z.array(FlamegraphProfileSchema),
    projectID: z.number(),
    shared: z.object({
      frames: z.array(FlamegraphFrameSchema),
      frame_infos: z.array(FlamegraphFrameInfoSchema),
      profiles: z.array(FlamegraphProfileMetadataSchema),
    }),
    transactionName: z.string().optional(),
    metrics: z.unknown().optional(),
  })
  .passthrough();

/**
 * Schema for individual frames in raw profile chunk data.
 *
 * Similar to FlamegraphFrameSchema but uses different field names
 * (function instead of name, in_app instead of is_application).
 * Many fields are optional as the API may not include them for all frames.
 */
export const ProfileFrameSchema = z
  .object({
    filename: z.string().nullable().optional(),
    function: z.string(),
    in_app: z.boolean(),
    lineno: z.number().nullable().optional(),
    module: z.string().nullable().optional(),
    abs_path: z.string().nullable().optional(),
    platform: z.string().nullable().optional(),
    data: z.record(z.unknown()).optional(),
  })
  .passthrough();

/**
 * Schema for individual samples in raw profile chunk data.
 *
 * Each sample represents a point-in-time snapshot of the call stack,
 * with a reference to the stack_id and thread_id.
 */
export const ProfileSampleSchema = z
  .object({
    stack_id: z.number(),
    thread_id: z.string(),
    timestamp: z.number(),
  })
  .passthrough();

/**
 * Schema for raw profile chunk data.
 *
 * Contains the raw sampling data including:
 * - frames: All unique stack frames
 * - samples: Individual sample points with timestamps
 * - stacks: Arrays of frame indices forming call stacks
 * - thread_metadata: Information about profiled threads
 *
 * This is used for deep-dive analysis when flamegraph data isn't sufficient.
 */
export const ProfileChunkSchema = z
  .object({
    chunk_id: z.string(),
    profiler_id: z.string(),
    environment: z.string().nullable(),
    platform: z.string(),
    release: z.string(),
    version: z.string(),
    profile: z.object({
      frames: z.array(ProfileFrameSchema),
      samples: z.array(ProfileSampleSchema),
      stacks: z.array(z.array(z.number())),
      thread_metadata: z.record(
        z
          .object({
            name: z.string().nullable(),
          })
          .passthrough(),
      ),
    }),
  })
  .passthrough();

/**
 * Schema for profile chunks API response wrapper.
 *
 * The API returns chunks in an array wrapper, even for single chunk requests.
 */
export const ProfileChunkResponseSchema = z
  .object({
    chunks: z.array(ProfileChunkSchema),
  })
  .passthrough();
