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
  UserSchema,
  UserRegionsSchema,
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
  User,
} from "./types";
// TODO: this is shared - so ideally, for safety, it uses @sentry/core, but currently
// logger isnt exposed (or rather, it is, but its not the right logger)
// import { logger } from "@sentry/node";

/**
 * Custom error class for Sentry API responses.
 *
 * Provides enhanced error messages for LLM consumption and handles
 * common API error scenarios with user-friendly messaging.
 *
 * @example
 * ```typescript
 * try {
 *   await apiService.listIssues({ organizationSlug: "invalid" });
 * } catch (error) {
 *   if (error instanceof ApiError) {
 *     console.log(`API Error ${error.status}: ${error.message}`);
 *   }
 * }
 * ```
 */
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

/**
 * Sentry API client service for interacting with Sentry's REST API.
 *
 * This service provides a comprehensive interface to Sentry's API endpoints,
 * handling authentication, error processing, multi-region support, and
 * response validation through Zod schemas.
 *
 * Key Features:
 * - Multi-region support for Sentry SaaS and self-hosted instances
 * - Automatic schema validation with Zod
 * - Enhanced error handling with LLM-friendly messages
 * - URL generation for Sentry resources (issues, traces)
 * - Bearer token authentication
 *
 * @example Basic Usage
 * ```typescript
 * const apiService = new SentryApiService({
 *   accessToken: "your-token",
 *   host: "sentry.io"
 * });
 *
 * const orgs = await apiService.listOrganizations();
 * const issues = await apiService.listIssues({
 *   organizationSlug: "my-org",
 *   query: "is:unresolved"
 * });
 * ```
 *
 * @example Multi-Region Support
 * ```typescript
 * // Self-hosted instance
 * const selfHosted = new SentryApiService({
 *   accessToken: "token",
 *   host: "sentry.company.com"
 * });
 *
 * // Regional endpoint override
 * const issues = await apiService.listIssues(
 *   { organizationSlug: "org" },
 *   { host: "eu.sentry.io" }
 * );
 * ```
 */
export class SentryApiService {
  private accessToken: string | null;
  protected host: string;
  protected apiPrefix: string;

  /**
   * Creates a new Sentry API service instance.
   *
   * @param config Configuration object
   * @param config.accessToken OAuth access token for authentication (optional for some endpoints)
   * @param config.host Sentry host (defaults to sentry.io)
   */
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

  /**
   * Updates the host for API requests.
   *
   * Used for multi-region support or switching between Sentry instances.
   *
   * @param host New host to use for API requests
   */
  setHost(host: string) {
    this.host = host;
    this.apiPrefix = new URL("/api/0", `https://${this.host}`).href;
  }

  /**
   * Internal method for making authenticated requests to Sentry API.
   *
   * Handles:
   * - Bearer token authentication
   * - Error response parsing and enhancement
   * - Multi-region host overrides
   * - Fetch availability validation
   *
   * @param path API endpoint path (without /api/0 prefix)
   * @param options Fetch options
   * @param requestOptions Additional request configuration
   * @returns Promise resolving to Response object
   * @throws {ApiError} Enhanced API errors with user-friendly messages
   * @throws {Error} Network or parsing errors
   */
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

    // Check if fetch is available, otherwise provide a helpful error message
    if (typeof globalThis.fetch === "undefined") {
      throw new Error(
        "fetch is not available. Please use Node.js >= 18 or ensure fetch is available in your environment.",
      );
    }

    // logger.info(logger.fmt`[sentryApi] ${options.method || "GET"} ${url}`);
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

  /**
   * Generates a Sentry issue URL for browser navigation.
   *
   * Handles both SaaS (subdomain-based) and self-hosted URL formats.
   *
   * @param organizationSlug Organization identifier
   * @param issueId Issue identifier (short ID or numeric ID)
   * @returns Full HTTPS URL to the issue in Sentry UI
   *
   * @example
   * ```typescript
   * // SaaS: https://my-org.sentry.io/issues/PROJ-123
   * apiService.getIssueUrl("my-org", "PROJ-123")
   *
   * // Self-hosted: https://sentry.company.com/organizations/my-org/issues/PROJ-123
   * apiService.getIssueUrl("my-org", "PROJ-123")
   * ```
   */
  getIssueUrl(organizationSlug: string, issueId: string): string {
    return this.host !== "sentry.io"
      ? `https://${this.host}/organizations/${organizationSlug}/issues/${issueId}`
      : `https://${organizationSlug}.${this.host}/issues/${issueId}`;
  }

  /**
   * Generates a Sentry trace URL for performance investigation.
   *
   * @param organizationSlug Organization identifier
   * @param traceId Trace identifier (hex string)
   * @returns Full HTTPS URL to the trace in Sentry UI
   *
   * @example
   * ```typescript
   * const traceUrl = apiService.getTraceUrl("my-org", "6a477f5b0f31ef7b6b9b5e1dea66c91d");
   * // https://my-org.sentry.io/explore/traces/trace/6a477f5b0f31ef7b6b9b5e1dea66c91d
   * ```
   */
  getTraceUrl(organizationSlug: string, traceId: string): string {
    return this.host !== "sentry.io"
      ? `https://${this.host}/organizations/${organizationSlug}/explore/traces/trace/${traceId}`
      : `https://${organizationSlug}.${this.host}/explore/traces/trace/${traceId}`;
  }

  /**
   * Retrieves the authenticated user's profile information.
   *
   * @param opts Request options including host override
   * @returns User profile data
   * @throws {ApiError} If authentication fails or user not found
   */
  async getAuthenticatedUser(opts?: RequestOptions): Promise<User> {
    const response = await this.request("/auth/", undefined, opts);
    const body = await response.json();
    return UserSchema.parse(body);
  }

  /**
   * Lists all organizations accessible to the authenticated user.
   *
   * Automatically handles multi-region queries by fetching from all
   * available regions and combining results.
   *
   * @param opts Request options
   * @returns Array of organizations across all accessible regions
   *
   * @example
   * ```typescript
   * const orgs = await apiService.listOrganizations();
   * orgs.forEach(org => {
   *   console.log(`${org.name} (${org.slug}) - ${org.links.regionUrl}`);
   * });
   * ```
   */
  async listOrganizations(opts?: RequestOptions): Promise<OrganizationList> {
    // TODO: Sentry is currently not returning all orgs without hitting region endpoints
    const regionResponse = await this.request(
      "/users/me/regions/",
      undefined,
      opts,
    );
    const regionData = UserRegionsSchema.parse(await regionResponse.json());

    return (
      await Promise.all(
        regionData.regions.map(async (region) =>
          this.request(`/organizations/`, undefined, {
            ...opts,
            host: new URL(region.url).host,
          }).then((response) => response.json()),
        ),
      )
    )
      .map((data) => OrganizationListSchema.parse(data))
      .reduce((acc, curr) => acc.concat(curr), []);
  }

  /**
   * Lists teams within an organization.
   *
   * @param organizationSlug Organization identifier
   * @param opts Request options including host override
   * @returns Array of teams in the organization
   */
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

  /**
   * Creates a new team within an organization.
   *
   * @param params Team creation parameters
   * @param params.organizationSlug Organization identifier
   * @param params.name Team name
   * @param opts Request options
   * @returns Created team data
   * @throws {ApiError} If team creation fails (e.g., name conflicts)
   */
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

  /**
   * Lists projects within an organization.
   *
   * @param organizationSlug Organization identifier
   * @param opts Request options
   * @returns Array of projects in the organization
   */
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

  /**
   * Creates a new project within a team.
   *
   * @param params Project creation parameters
   * @param params.organizationSlug Organization identifier
   * @param params.teamSlug Team identifier
   * @param params.name Project name
   * @param params.platform Platform identifier (e.g., "javascript", "python")
   * @param opts Request options
   * @returns Created project data
   */
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

  /**
   * Updates an existing project's configuration.
   *
   * @param params Project update parameters
   * @param params.organizationSlug Organization identifier
   * @param params.projectSlug Current project identifier
   * @param params.name New project name (optional)
   * @param params.slug New project slug (optional)
   * @param params.platform New platform identifier (optional)
   * @param opts Request options
   * @returns Updated project data
   */
  async updateProject(
    {
      organizationSlug,
      projectSlug,
      name,
      slug,
      platform,
    }: {
      organizationSlug: string;
      projectSlug: string;
      name?: string;
      slug?: string;
      platform?: string;
    },
    opts?: RequestOptions,
  ): Promise<Project> {
    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = slug;
    if (platform !== undefined) updateData.platform = platform;

    const response = await this.request(
      `/projects/${organizationSlug}/${projectSlug}/`,
      {
        method: "PUT",
        body: JSON.stringify(updateData),
      },
      opts,
    );
    return ProjectSchema.parse(await response.json());
  }

  /**
   * Assigns a team to a project.
   *
   * @param params Assignment parameters
   * @param params.organizationSlug Organization identifier
   * @param params.projectSlug Project identifier
   * @param params.teamSlug Team identifier to assign
   * @param opts Request options
   */
  async addTeamToProject(
    {
      organizationSlug,
      projectSlug,
      teamSlug,
    }: {
      organizationSlug: string;
      projectSlug: string;
      teamSlug: string;
    },
    opts?: RequestOptions,
  ): Promise<void> {
    await this.request(
      `/projects/${organizationSlug}/${projectSlug}/teams/${teamSlug}/`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
      opts,
    );
  }

  /**
   * Creates a new client key (DSN) for a project.
   *
   * Client keys are used to identify and authenticate SDK requests to Sentry.
   *
   * @param params Key creation parameters
   * @param params.organizationSlug Organization identifier
   * @param params.projectSlug Project identifier
   * @param params.name Human-readable name for the key (optional)
   * @param opts Request options
   * @returns Created client key with DSN information
   *
   * @example
   * ```typescript
   * const key = await apiService.createClientKey({
   *   organizationSlug: "my-org",
   *   projectSlug: "my-project",
   *   name: "Production"
   * });
   * console.log(`DSN: ${key.dsn.public}`);
   * ```
   */
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

  /**
   * Lists all client keys (DSNs) for a project.
   *
   * @param params Query parameters
   * @param params.organizationSlug Organization identifier
   * @param params.projectSlug Project identifier
   * @param opts Request options
   * @returns Array of client keys with DSN information
   */
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

  /**
   * Lists releases for an organization or specific project.
   *
   * @param params Query parameters
   * @param params.organizationSlug Organization identifier
   * @param params.projectSlug Project identifier (optional, scopes to specific project)
   * @param params.query Search query for filtering releases
   * @param opts Request options
   * @returns Array of releases with deployment and commit information
   *
   * @example
   * ```typescript
   * // All releases for organization
   * const releases = await apiService.listReleases({
   *   organizationSlug: "my-org"
   * });
   *
   * // Search for specific version
   * const filtered = await apiService.listReleases({
   *   organizationSlug: "my-org",
   *   query: "v1.2.3"
   * });
   * ```
   */
  async listReleases(
    {
      organizationSlug,
      projectSlug,
      query,
    }: {
      organizationSlug: string;
      projectSlug?: string;
      query?: string;
    },
    opts?: RequestOptions,
  ): Promise<ReleaseList> {
    const searchQuery = new URLSearchParams();
    if (query) {
      searchQuery.set("query", query);
    }

    const path = projectSlug
      ? `/projects/${organizationSlug}/${projectSlug}/releases/`
      : `/organizations/${organizationSlug}/releases/`;

    const response = await this.request(
      `${path}${searchQuery.toString()}`,
      undefined,
      opts,
    );

    const body = await response.json();
    return ReleaseListSchema.parse(body);
  }

  /**
   * Lists available tags for search queries.
   *
   * Tags represent indexed fields that can be used in Sentry search queries.
   *
   * @param params Query parameters
   * @param params.organizationSlug Organization identifier
   * @param params.dataset Dataset to query tags for ("errors" or "search_issues")
   * @param opts Request options
   * @returns Array of available tags with metadata
   *
   * @example
   * ```typescript
   * const tags = await apiService.listTags({
   *   organizationSlug: "my-org",
   *   dataset: "errors"
   * });
   * tags.forEach(tag => console.log(`${tag.key}: ${tag.name}`));
   * ```
   */
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

  /**
   * Lists issues within an organization or project.
   *
   * Issues represent groups of similar errors or problems in your application.
   * Supports Sentry's powerful query syntax for filtering and sorting.
   *
   * @param params Query parameters
   * @param params.organizationSlug Organization identifier
   * @param params.projectSlug Project identifier (optional, scopes to specific project)
   * @param params.query Sentry search query (e.g., "is:unresolved browser:chrome")
   * @param params.sortBy Sort order ("user", "freq", "date", "new")
   * @param opts Request options
   * @returns Array of issues with metadata and statistics
   *
   * @example
   * ```typescript
   * // Recent unresolved issues
   * const issues = await apiService.listIssues({
   *   organizationSlug: "my-org",
   *   query: "is:unresolved",
   *   sortBy: "date"
   * });
   *
   * // High-frequency errors in specific project
   * const critical = await apiService.listIssues({
   *   organizationSlug: "my-org",
   *   projectSlug: "backend",
   *   query: "level:error",
   *   sortBy: "freq"
   * });
   * ```
   */
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

  async updateIssue(
    {
      organizationSlug,
      issueId,
      status,
      assignedTo,
    }: {
      organizationSlug: string;
      issueId: string;
      status?: string;
      assignedTo?: string;
    },
    opts?: RequestOptions,
  ): Promise<Issue> {
    const updateData: Record<string, any> = {};
    if (status !== undefined) updateData.status = status;
    if (assignedTo !== undefined) updateData.assignedTo = assignedTo;

    const response = await this.request(
      `/organizations/${organizationSlug}/issues/${issueId}/`,
      {
        method: "PUT",
        body: JSON.stringify(updateData),
      },
      opts,
    );

    const body = await response.json();
    return IssueSchema.parse(body);
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
