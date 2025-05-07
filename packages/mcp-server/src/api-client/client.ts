import { logError } from "../logging";
import {
  OrganizationListSchema,
  ClientKeySchema,
  TeamListSchema,
  TeamSchema,
  ProjectListSchema,
  ProjectSchema,
  ReleaseListSchema,
  IssueListSchema,
  IssueSchema,
  EventSchema,
  ErrorsSearchResponseSchema,
  SpansSearchResponseSchema,
  TagListSchema,
  ApiErrorSchema,
  ClientKeyListSchema,
  AutofixRunSchema,
  AutofixRunStateSchema,
} from "./schema";
import type {
  AutofixRun,
  AutofixRunState,
  ClientKey,
  ClientKeyList,
  Event,
  Issue,
  IssueList,
  OrganizationList,
  Project,
  ProjectList,
  ReleaseList,
  TagList,
  Team,
  TeamList,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    // HACK: improving this error message for the LLMs
    let finalMessage = message;
    if (
      message.includes(
        "You do not have the multi project stream feature enabled",
      ) ||
      message.includes("You cannot view events from multiple projects")
    ) {
      finalMessage =
        "You do not have access to query across multiple projects. Please select a project for your query.";
    }
    super(finalMessage);
  }
}

type RequestOptions = {
  host?: string;
};

export class SentryApiService {
  private accessToken: string | null;
  protected host: string;
  protected apiPrefix: string;

  constructor({
    accessToken = null,
    host = process.env.SENTRY_HOST,
  }: {
    accessToken?: string | null;
    host?: string;
  }) {
    this.accessToken = accessToken;
    this.host = host || "sentry.io";
    this.apiPrefix = new URL("/api/0", `https://${this.host}`).href;
  }

  setHost(host: string) {
    this.host = host;
    this.apiPrefix = new URL("/api/0", `https://${this.host}`).href;
  }

  private async request(
    path: string,
    options: RequestInit = {},
    { host }: { host?: string } = {},
  ): Promise<Response> {
    const url = host
      ? new URL(`/api/0${path}`, `https://${host}`).href
      : `${this.apiPrefix}${path}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    console.log(`[sentryApi] ${options.method || "GET"} ${url}`);
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsed: unknown | undefined;
      try {
        parsed = JSON.parse(errorText);
      } catch (error) {
        console.error(
          `[sentryApi] Failed to parse error response: ${errorText}`,
          error,
        );
      }

      if (parsed) {
        const { data, success, error } = ApiErrorSchema.safeParse(parsed);

        if (success) {
          throw new ApiError(data.detail, response.status);
        }

        console.error(
          `[sentryApi] Failed to parse error response: ${errorText}`,
          error,
        );
      }

      throw new Error(
        `API request failed: ${response.status} ${response.statusText}\n${errorText}`,
      );
    }

    return response;
  }

  getIssueUrl(organizationSlug: string, issueId: string): string {
    return this.host !== "sentry.io"
      ? `https://${this.host}/organizations/${organizationSlug}/issues/${issueId}`
      : `https://${organizationSlug}.${this.host}/issues/${issueId}`;
  }

  getTraceUrl(organizationSlug: string, traceId: string): string {
    return this.host !== "sentry.io"
      ? `https://${this.host}/organizations/${organizationSlug}/explore/traces/trace/${traceId}`
      : `https://${organizationSlug}.${this.host}/explore/traces/trace/${traceId}`;
  }

  async listOrganizations(opts?: RequestOptions): Promise<OrganizationList> {
    const response = await this.request("/organizations/", undefined, opts);

    const body = await response.json();
    return OrganizationListSchema.parse(body);
  }

  async listTeams(
    organizationSlug: string,
    opts?: RequestOptions,
  ): Promise<TeamList> {
    const response = await this.request(
      `/organizations/${organizationSlug}/teams/`,
      undefined,
      opts,
    );

    const body = await response.json();
    return TeamListSchema.parse(body);
  }

  async createTeam(
    {
      organizationSlug,
      name,
    }: {
      organizationSlug: string;
      name: string;
    },
    opts?: RequestOptions,
  ): Promise<Team> {
    const response = await this.request(
      `/organizations/${organizationSlug}/teams/`,
      {
        method: "POST",
        body: JSON.stringify({ name }),
      },
      opts,
    );

    return TeamSchema.parse(await response.json());
  }

  async listProjects(
    organizationSlug: string,
    opts?: RequestOptions,
  ): Promise<ProjectList> {
    const response = await this.request(
      `/organizations/${organizationSlug}/projects/`,
      undefined,
      opts,
    );

    const body = await response.json();
    return ProjectListSchema.parse(body);
  }

  async createProject(
    {
      organizationSlug,
      teamSlug,
      name,
      platform,
    }: {
      organizationSlug: string;
      teamSlug: string;
      name: string;
      platform?: string;
    },
    opts?: RequestOptions,
  ): Promise<Project> {
    const response = await this.request(
      `/teams/${organizationSlug}/${teamSlug}/projects/`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          platform,
        }),
      },
      opts,
    );
    return ProjectSchema.parse(await response.json());
  }

  async createClientKey(
    {
      organizationSlug,
      projectSlug,
      name,
    }: {
      organizationSlug: string;
      projectSlug: string;
      name?: string;
    },
    opts?: RequestOptions,
  ): Promise<ClientKey> {
    const response = await this.request(
      `/projects/${organizationSlug}/${projectSlug}/keys/`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
        }),
      },
      opts,
    );
    return ClientKeySchema.parse(await response.json());
  }

  async listClientKeys(
    {
      organizationSlug,
      projectSlug,
    }: {
      organizationSlug: string;
      projectSlug: string;
    },
    opts?: RequestOptions,
  ): Promise<ClientKeyList> {
    const response = await this.request(
      `/projects/${organizationSlug}/${projectSlug}/keys/`,
      undefined,
      opts,
    );
    return ClientKeyListSchema.parse(await response.json());
  }

  async listReleases(
    {
      organizationSlug,
      projectSlug,
    }: {
      organizationSlug: string;
      projectSlug?: string;
    },
    opts?: RequestOptions,
  ): Promise<ReleaseList> {
    const response = await this.request(
      projectSlug
        ? `/projects/${organizationSlug}/${projectSlug}/releases/`
        : `/organizations/${organizationSlug}/releases/`,
      undefined,
      opts,
    );

    const body = await response.json();
    return ReleaseListSchema.parse(body);
  }

  async listTags(
    {
      organizationSlug,
      dataset,
    }: {
      organizationSlug: string;
      dataset?: "errors" | "search_issues";
    },
    opts?: RequestOptions,
  ): Promise<TagList> {
    // TODO: this supports project in the query, but needs fixed
    // to accept slugs
    const searchQuery = new URLSearchParams();
    if (dataset) {
      searchQuery.set("dataset", dataset);
    }

    const response = await this.request(
      `/organizations/${organizationSlug}/tags/${searchQuery.toString()}`,
      undefined,
      opts,
    );

    const body = await response.json();
    return TagListSchema.parse(body);
  }

  async listIssues(
    {
      organizationSlug,
      projectSlug,
      query,
      sortBy,
    }: {
      organizationSlug: string;
      projectSlug?: string;
      query?: string;
      sortBy?: "user" | "freq" | "date" | "new";
    },
    opts?: RequestOptions,
  ): Promise<IssueList> {
    const sentryQuery: string[] = [];
    if (query) {
      sentryQuery.push(query);
    }

    const queryParams = new URLSearchParams();
    queryParams.set("per_page", "10");
    queryParams.set("referrer", "sentry-mcp");
    if (sortBy) queryParams.set("sort", sortBy);
    queryParams.set("statsPeriod", "24h");
    queryParams.set("query", sentryQuery.join(" "));

    queryParams.append("collapse", "unhandled");

    const apiUrl = projectSlug
      ? `/projects/${organizationSlug}/${projectSlug}/issues/?${queryParams.toString()}`
      : `/organizations/${organizationSlug}/issues/?${queryParams.toString()}`;

    const response = await this.request(apiUrl, undefined, opts);

    const body = await response.json();
    return IssueListSchema.parse(body);
  }

  async getIssue(
    {
      organizationSlug,
      issueId,
    }: {
      organizationSlug: string;
      issueId: string;
    },
    opts?: RequestOptions,
  ): Promise<Issue> {
    const response = await this.request(
      `/organizations/${organizationSlug}/issues/${issueId}/`,
      undefined,
      opts,
    );

    const body = await response.json();
    return IssueSchema.parse(body);
  }

  async getEventForIssue(
    {
      organizationSlug,
      issueId,
      eventId,
    }: {
      organizationSlug: string;
      issueId: string;
      eventId: string;
    },
    opts?: RequestOptions,
  ): Promise<Event> {
    const response = await this.request(
      `/organizations/${organizationSlug}/issues/${issueId}/events/${eventId}/`,
      undefined,
      opts,
    );

    const body = await response.json();
    return EventSchema.parse(body);
  }

  async getLatestEventForIssue(
    {
      organizationSlug,
      issueId,
    }: {
      organizationSlug: string;
      issueId: string;
    },
    opts?: RequestOptions,
  ): Promise<Event> {
    return this.getEventForIssue(
      {
        organizationSlug,
        issueId,
        eventId: "latest",
      },
      opts,
    );
  }

  // TODO: Sentry is not yet exposing a reasonable API to fetch trace data
  // async getTrace({
  //   organizationSlug,
  //   traceId,
  // }: {
  //   organizationSlug: string;
  //   traceId: string;
  // }): Promise<z.infer<typeof SentryIssueSchema>> {
  //   const response = await this.request(
  //     `/organizations/${organizationSlug}/issues/${traceId}/`,
  //   );

  //   const body = await response.json();
  //   return SentryIssueSchema.parse(body);
  // }

  async searchErrors(
    {
      organizationSlug,
      projectSlug,
      filename,
      transaction,
      query,
      sortBy = "last_seen",
    }: {
      organizationSlug: string;
      projectSlug?: string;
      filename?: string;
      transaction?: string;
      query?: string;
      sortBy?: "last_seen" | "count";
    },
    opts?: RequestOptions,
  ) {
    const sentryQuery: string[] = [];
    if (filename) {
      sentryQuery.push(`stack.filename:"*${filename.replace(/"/g, '\\"')}"`);
    }
    if (transaction) {
      sentryQuery.push(`transaction:"${transaction.replace(/"/g, '\\"')}"`);
    }
    if (query) {
      sentryQuery.push(query);
    }
    if (projectSlug) {
      sentryQuery.push(`project:${projectSlug}`);
    }

    const queryParams = new URLSearchParams();
    queryParams.set("dataset", "errors");
    queryParams.set("per_page", "10");
    queryParams.set("referrer", "sentry-mcp");
    queryParams.set(
      "sort",
      `-${sortBy === "last_seen" ? "last_seen" : "count"}`,
    );
    queryParams.set("statsPeriod", "24h");
    queryParams.append("field", "issue");
    queryParams.append("field", "title");
    queryParams.append("field", "project");
    queryParams.append("field", "last_seen()");
    queryParams.append("field", "count()");
    queryParams.set("query", sentryQuery.join(" "));
    // if (projectSlug) queryParams.set("project", projectSlug);

    const apiUrl = `/organizations/${organizationSlug}/events/?${queryParams.toString()}`;

    const response = await this.request(apiUrl, undefined, opts);

    const body = await response.json();
    // TODO(dcramer): If you're using an older version of Sentry this API had a breaking change
    // meaning this endpoint will error.
    return ErrorsSearchResponseSchema.parse(body).data;
  }

  async searchSpans(
    {
      organizationSlug,
      projectSlug,
      transaction,
      query,
      sortBy = "timestamp",
    }: {
      organizationSlug: string;
      projectSlug?: string;
      transaction?: string;
      query?: string;
      sortBy?: "timestamp" | "duration";
    },
    opts?: RequestOptions,
  ) {
    const sentryQuery: string[] = ["is_transaction:true"];
    if (transaction) {
      sentryQuery.push(`transaction:"${transaction.replace(/"/g, '\\"')}"`);
    }
    if (query) {
      sentryQuery.push(query);
    }
    if (projectSlug) {
      sentryQuery.push(`project:${projectSlug}`);
    }

    const queryParams = new URLSearchParams();
    queryParams.set("dataset", "spans");
    queryParams.set("per_page", "10");
    queryParams.set("referrer", "sentry-mcp");
    queryParams.set(
      "sort",
      `-${sortBy === "timestamp" ? "timestamp" : "span.duration"}`,
    );
    queryParams.set("allowAggregateConditions", "0");
    queryParams.set("useRpc", "1");
    queryParams.append("field", "id");
    queryParams.append("field", "trace");
    queryParams.append("field", "span.op");
    queryParams.append("field", "span.description");
    queryParams.append("field", "span.duration");
    queryParams.append("field", "transaction");
    queryParams.append("field", "project");
    queryParams.append("field", "timestamp");
    queryParams.set("query", sentryQuery.join(" "));
    // if (projectSlug) queryParams.set("project", projectSlug);

    const apiUrl = `/organizations/${organizationSlug}/events/?${queryParams.toString()}`;

    const response = await this.request(apiUrl, undefined, opts);

    const body = await response.json();
    return SpansSearchResponseSchema.parse(body).data;
  }

  // POST https://us.sentry.io/api/0/issues/5485083130/autofix/
  async startAutofix(
    {
      organizationSlug,
      issueId,
      eventId,
      instruction = "",
    }: {
      organizationSlug: string;
      issueId: string;
      eventId?: string;
      instruction?: string;
    },
    opts?: RequestOptions,
  ): Promise<AutofixRun> {
    const response = await this.request(
      `/organizations/${organizationSlug}/issues/${issueId}/autofix/`,
      {
        method: "POST",
        body: JSON.stringify({
          event_id: eventId,
          instruction,
        }),
      },
      opts,
    );
    const body = await response.json();
    return AutofixRunSchema.parse(body);
  }

  // GET https://us.sentry.io/api/0/issues/5485083130/autofix/
  async getAutofixState(
    {
      organizationSlug,
      issueId,
    }: {
      organizationSlug: string;
      issueId: string;
    },
    opts?: RequestOptions,
  ): Promise<AutofixRunState> {
    const response = await this.request(
      `/organizations/${organizationSlug}/issues/${issueId}/autofix/`,
      undefined,
      opts,
    );
    const body = await response.json();
    return AutofixRunStateSchema.parse(body);
  }
}
