import { z } from "zod";

export const ApiErrorSchema = z.object({
  detail: z.string(),
});

export const OrganizationSchema = z.object({
  id: z.union([z.string(), z.number()]),
  slug: z.string(),
  name: z.string(),
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
});

export const ProjectListSchema = z.array(ProjectSchema);

export const ClientKeySchema = z.object({
  id: z.union([z.string(), z.number()]),
  dsn: z.object({
    public: z.string(),
  }),
});

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
  platform: z.string(),
  status: z.string(),
  culprit: z.string(),
  type: z.union([z.literal("error"), z.string()]),
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

export const EventSchema = z.object({
  id: z.string(),
  title: z.string(),
  message: z.string().nullable(),
  dateCreated: z.string().datetime(),
  culprit: z.string().nullable(),
  platform: z.string().nullable(),
  entries: z.array(
    z.union([
      // TODO: there are other types
      z.object({
        type: z.literal("exception"),
        data: ErrorEntrySchema,
      }),
      z.object({
        type: z.string(),
        data: z.unknown(),
      }),
    ]),
  ),
});

export const EventsResponseSchema = z.object({
  data: z.array(z.unknown()),
  meta: z.object({
    fields: z.record(z.string(), z.string()),
    units: z.record(z.string(), z.string().nullable()),
  }),
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
