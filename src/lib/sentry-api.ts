import { z } from "zod";
import { logError } from "./logging";

const API_BASE_URL = new URL(
  "/api/0",
  process.env.SENTRY_URL || "https://sentry.io",
);

export const SentryOrgSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
  })
  .passthrough();

export const SentryTeamSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
  })
  .passthrough();

export const SentryProjectSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
  })
  .passthrough();

export const SentryClientKeySchema = z
  .object({
    id: z.string(),
    dsn: z
      .object({
        public: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

export const SentryIssueSchema = z
  .object({
    id: z.string(),
    shortId: z.string(),
    title: z.string(),
    lastSeen: z.string().datetime(),
    count: z.number(),
    permalink: z.string().url(),
  })
  .passthrough();

export const SentryAutofixRunSchema = z
  .object({
    run_id: z.number(),
  })
  .passthrough();

const SentryAutofixRunStepBaseSchema = z.object({
  type: z.string(),
  key: z.union([
    z.literal("root_cause_analysis_processing"),
    z.literal("root_cause_analysis"),
    z.literal("solution_processing"),
    z.literal("solution"),
    z.string(),
  ]),
  index: z.number(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "FAILED"]),
  title: z.string(),
  output_stream: z.string().nullable(),
  progress: z.array(
    z.object({
      data: z.unknown().nullable(),
      message: z.string(),
      timestamp: z.string().datetime(),
      type: z.enum(["INFO", "WARNING", "ERROR"]),
    }),
  ),
});

export const SentryAutofixRunStepDefaultSchema =
  SentryAutofixRunStepBaseSchema.extend({
    type: z.literal("default"),
    insights: z.array(
      z.object({
        change_diff: z.unknown().nullable(),
        generated_at_memory_index: z.number(),
        insight: z.string(),
        justification: z.string(),
        type: z.literal("insight"),
      }),
    ),
  }).passthrough();

export const SentryAutofixRunStepRootCauseAnalysisSchema =
  SentryAutofixRunStepBaseSchema.extend({
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

export const SentryAutofixRunStepSolutionSchema =
  SentryAutofixRunStepBaseSchema.extend({
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

export const SentryAutofixRunStateSchema = z.object({
  autofix: z
    .object({
      run_id: z.number(),
      request: z
        .object({
          project_id: z.number(),
          issue: z
            .object({
              id: z.number(),
            })
            .passthrough(),
        })
        .passthrough(),
      updated_at: z.string().datetime(),
      status: z.enum(["NEED_MORE_INFORMATION", "PROCESSING"]),
      steps: z.array(
        z.union([
          SentryAutofixRunStepDefaultSchema,
          SentryAutofixRunStepRootCauseAnalysisSchema,
          SentryAutofixRunStepSolutionSchema,
          SentryAutofixRunStepBaseSchema.passthrough(),
        ]),
      ),
    })
    .passthrough(),
});

// XXX: Sentry's schema generally speaking is "assume all user input is missing"
// so we need to handle effectively every field being optional or nullable.
const ExceptionInterface = z
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
      frames: z.array(
        z
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
          .partial(),
      ),
    }),
  })
  .partial();

export const SentryErrorEntrySchema = z.object({
  // XXX: Sentry can return either of these. Not sure why we never normalized it.
  values: z.array(ExceptionInterface.optional()),
  value: ExceptionInterface.nullable().optional(),
});

export const SentryEventSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    message: z.string().nullable(),
    dateCreated: z.string().datetime(),
    culprit: z.string().nullable(),
    entries: z.array(
      z.union([
        // TODO: there are other types
        z.object({
          type: z.literal("exception"),
          data: SentryErrorEntrySchema,
        }),
        z.object({
          type: z.string(),
          data: z.unknown(),
        }),
      ]),
    ),
  })
  .passthrough();

// https://us.sentry.io/api/0/organizations/sentry/events/?dataset=errors&field=issue&field=title&field=project&field=timestamp&field=trace&per_page=5&query=event.type%3Aerror&referrer=sentry-mcp&sort=-timestamp&statsPeriod=1w
export const SentryDiscoverEventSchema = z
  .object({
    issue: z.string(),
    "issue.id": z.union([z.string(), z.number()]),
    project: z.string(),
    title: z.string(),
    "count()": z.number(),
    "last_seen()": z.string(),
  })
  .passthrough();

/**
 * Extracts the Sentry issue ID and organization slug from a full URL
 *
 * @param url - A full Sentry issue URL
 * @returns Object containing the numeric issue ID and organization slug (if found)
 * @throws Error if the input is invalid
 */
export function extractIssueId(url: string): {
  issueId: string;
  organizationSlug: string;
} {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error(
      "Invalid Sentry issue URL. Must start with http:// or https://",
    );
  }

  const parsedUrl = new URL(url);

  const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
  if (pathParts.length < 2 || !pathParts.includes("issues")) {
    throw new Error(
      "Invalid Sentry issue URL. Path must contain '/issues/{issue_id}'",
    );
  }

  const issueId = pathParts[pathParts.indexOf("issues") + 1];
  if (!issueId || !/^\d+$/.test(issueId)) {
    throw new Error("Invalid Sentry issue ID. Must be a numeric value.");
  }

  // Extract organization slug from either the path or subdomain
  let organizationSlug: string | undefined;
  if (pathParts.includes("organizations")) {
    organizationSlug = pathParts[pathParts.indexOf("organizations") + 1];
  } else if (pathParts.length > 1 && pathParts[0] !== "issues") {
    // If URL is like sentry.io/sentry/issues/123
    organizationSlug = pathParts[0];
  } else {
    // Check for subdomain
    const hostParts = parsedUrl.hostname.split(".");
    if (hostParts.length > 2 && hostParts[0] !== "www") {
      organizationSlug = hostParts[0];
    }
  }

  if (!organizationSlug) {
    throw new Error(
      "Invalid Sentry issue URL. Could not determine organization.",
    );
  }

  return { issueId, organizationSlug };
}

export class SentryApiService {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async request(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}\n${errorText}`,
      );
    }

    return response;
  }

  async listOrganizations(): Promise<z.infer<typeof SentryOrgSchema>[]> {
    const response = await this.request("/organizations/");

    const orgsBody = await response.json<{ id: string; slug: string }[]>();
    return orgsBody.map((i) => SentryOrgSchema.parse(i));
  }

  async listTeams(
    organizationSlug: string,
  ): Promise<z.infer<typeof SentryTeamSchema>[]> {
    const response = await this.request(
      `/organizations/${organizationSlug}/teams/`,
    );

    const teamsBody = await response.json<{ id: string; slug: string }[]>();
    return teamsBody.map((i) => SentryTeamSchema.parse(i));
  }

  async createTeam({
    organizationSlug,
    name,
  }: {
    organizationSlug: string;
    name: string;
  }): Promise<z.infer<typeof SentryTeamSchema>> {
    const response = await this.request(
      `/organizations/${organizationSlug}/teams/`,
      {
        method: "POST",
        body: JSON.stringify({ name }),
      },
    );

    return SentryTeamSchema.parse(await response.json());
  }

  async listProjects(
    organizationSlug: string,
  ): Promise<z.infer<typeof SentryProjectSchema>[]> {
    const response = await this.request(
      `/organizations/${organizationSlug}/projects/`,
    );

    const projectsBody = await response.json<{ id: string; slug: string }[]>();
    return projectsBody.map((i) => SentryProjectSchema.parse(i));
  }

  async createProject({
    organizationSlug,
    teamSlug,
    name,
    platform,
  }: {
    organizationSlug: string;
    teamSlug: string;
    name: string;
    platform?: string;
  }): Promise<
    [
      z.infer<typeof SentryProjectSchema>,
      z.infer<typeof SentryClientKeySchema> | null,
    ]
  > {
    const response = await this.request(
      `/teams/${organizationSlug}/${teamSlug}/projects/`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          platform,
        }),
      },
    );
    const project = SentryProjectSchema.parse(await response.json());

    try {
      const keysResponse = await this.request(
        `/projects/${organizationSlug}/${project.slug}/keys/`,
        {
          method: "POST",
          body: JSON.stringify({
            name: "Default",
          }),
        },
      );
      const clientKey = SentryClientKeySchema.parse(await keysResponse.json());
      return [project, clientKey];
    } catch (err) {
      logError(err);
    }
    return [project, null];
  }

  async getLatestEventForIssue({
    organizationSlug,
    issueId,
  }: {
    organizationSlug: string;
    issueId: string;
  }): Promise<z.infer<typeof SentryEventSchema>> {
    const response = await this.request(
      `/organizations/${organizationSlug}/issues/${issueId}/events/latest/`,
    );

    const body = await response.json();
    return SentryEventSchema.parse(body);
  }

  async searchErrors({
    organizationSlug,
    filename,
    query,
    projectSlug,
    sortBy = "last_seen",
  }: {
    organizationSlug: string;
    filename?: string;
    query?: string;
    projectSlug?: string;
    sortBy?: "last_seen" | "count";
  }): Promise<z.infer<typeof SentryDiscoverEventSchema>[]> {
    const sentryQuery = `${
      filename ? `stack.filename:"*${filename.replace(/"/g, '\\"')}" ` : ""
    }${query ?? ""}`;

    const queryParams = new URLSearchParams();
    queryParams.set("dataset", "errors");
    queryParams.set("per_page", "10");
    queryParams.set("referrer", "sentry-mcp");
    queryParams.set(
      "sort",
      `-${sortBy === "last_seen" ? "last_seen" : "count"}`,
    );
    queryParams.set("statsPeriod", "1w");
    queryParams.append("field", "issue");
    queryParams.append("field", "title");
    queryParams.append("field", "project");
    queryParams.append("field", "last_seen()");
    queryParams.append("field", "count()");
    queryParams.set("query", sentryQuery);
    if (projectSlug) queryParams.set("project", projectSlug);

    const apiUrl = `/organizations/${organizationSlug}/events/?${queryParams.toString()}`;

    const response = await this.request(apiUrl);

    const listBody = await response.json<{ data: unknown[] }>();
    return listBody.data.map((i) => SentryDiscoverEventSchema.parse(i));
  }

  // POST https://us.sentry.io/api/0/issues/5485083130/autofix/
  async startAutofix({
    issueId,
    eventId,
    instruction = "",
  }: {
    issueId: string;
    eventId: string;
    instruction?: string;
  }): Promise<z.infer<typeof SentryAutofixRunSchema>> {
    const response = await this.request(`/issues/${issueId}/autofix/`, {
      method: "POST",
      body: JSON.stringify({
        event_id: eventId,
        instruction,
      }),
    });

    return SentryAutofixRunSchema.parse(await response.json());
  }

  // GET https://us.sentry.io/api/0/issues/5485083130/autofix/
  async getAutofixState({
    issueId,
  }: {
    issueId: string;
  }): Promise<z.infer<typeof SentryAutofixRunStateSchema>> {
    const response = await this.request(`/issues/${issueId}/autofix/`);

    return SentryAutofixRunStateSchema.parse(await response.json());
  }
}
