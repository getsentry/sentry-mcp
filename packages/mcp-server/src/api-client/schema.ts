import { z } from "zod";

export const ApiErrorSchema = z
  .object({
    detail: z.string(),
  })
  .passthrough();

export const UserSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string(),
  email: z.string(),
});

export const UserRegionsSchema = z.object({
  regions: z.array(
    z.object({
      name: z.string(),
      url: z.string().url(),
    }),
  ),
});

export const OrganizationSchema = z.object({
  id: z.union([z.string(), z.number()]),
  slug: z.string(),
  name: z.string(),
  links: z.object({
    regionUrl: z.string().url(),
    organizationUrl: z.string().url(),
  }),
});

export const OrganizationListSchema = z.array(OrganizationSchema);

export const TeamSchema = z.object({
  id: z.union([z.string(), z.number()]),
  slug: z.string(),
  name: z.string(),
});

export const TeamListSchema = z.array(TeamSchema);

export const ProjectSchema = z.object({
  id: z.union([z.string(), z.number()]),
  slug: z.string(),
  name: z.string(),
  platform: z.string().nullable(),
});

export const ProjectListSchema = z.array(ProjectSchema);

export const ClientKeySchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string(),
  dsn: z.object({
    public: z.string(),
  }),
  isActive: z.boolean(),
  dateCreated: z.string().datetime(),
});

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

export const IssueSchema = z.object({
  id: z.union([z.string(), z.number()]),
  shortId: z.string(),
  title: z.string(),
  firstSeen: z.string().datetime(),
  lastSeen: z.string().datetime(),
  count: z.union([z.string(), z.number()]),
  userCount: z.union([z.string(), z.number()]),
  permalink: z.string().url(),
  project: ProjectSchema,
  platform: z.string().nullable(),
  status: z.string(),
  culprit: z.string(),
  type: z.union([z.literal("error"), z.literal("transaction"), z.unknown()]),
  assignedTo: AssignedToSchema.optional(),
});

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

export const ErrorEntrySchema = z.object({
  // XXX: Sentry can return either of these. Not sure why we never normalized it.
  values: z.array(ExceptionInterface.optional()),
  value: ExceptionInterface.nullable().optional(),
});

export const RequestEntrySchema = z.object({
  method: z.string().nullable(),
  url: z.string().url().nullable(),
  // TODO:
  // query: z.array(z.tuple([z.string(), z.string()])).nullable(),
  // data: z.unknown().nullable(),
  // headers: z.array(z.tuple([z.string(), z.string()])).nullable(),
});

const BaseEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  message: z.string().nullable(),
  platform: z.string().nullable(),
  type: z.unknown(),
  entries: z.array(
    z.union([
      // TODO: there are other types
      z.object({
        type: z.literal("exception"),
        data: ErrorEntrySchema,
      }),
      z.object({
        type: z.literal("spans"),
        data: z.unknown(),
      }),
      z.object({
        type: z.literal("request"),
        data: z.unknown(),
      }),
      z.object({
        type: z.literal("breadcrumbs"),
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
});

export const ErrorEventSchema = BaseEventSchema.omit({
  type: true,
}).extend({
  type: z.literal("error"),
  culprit: z.string().nullable(),
  dateCreated: z.string().datetime(),
});

export const TransactionEventSchema = BaseEventSchema.omit({
  type: true,
}).extend({
  type: z.literal("transaction"),
  occurrence: z.object({
    issueTitle: z.string(),
    culprit: z.string().nullable(),
  }),
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
  TransactionEventSchema,
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
