import {
  getIssueUrl as getIssueUrlUtil,
  getTraceUrl as getTraceUrlUtil,
  isSentryHost,
} from "../utils/url-utils";
import { logWarn } from "../telem/logging";
import {
  OrganizationListSchema,
  OrganizationSchema,
  ClientKeySchema,
  TeamListSchema,
  TeamSchema,
  ProjectListSchema,
  ProjectSchema,
  ReleaseListSchema,
  IssueListSchema,
  IssueSchema,
  EventSchema,
  EventAttachmentListSchema,
  ErrorsSearchResponseSchema,
  SpansSearchResponseSchema,
  TagListSchema,
  ApiErrorSchema,
  ClientKeyListSchema,
  AutofixRunSchema,
  AutofixRunStateSchema,
  TraceMetaSchema,
  TraceSchema,
  UserSchema,
  UserRegionsSchema,
} from "./schema";
import { ConfigurationError } from "../errors";
import { createApiError, ApiNotFoundError, ApiValidationError } from "./errors";
import { USER_AGENT } from "../version";
import type {
  AutofixRun,
  AutofixRunState,
  ClientKey,
  ClientKeyList,
  Event,
  EventAttachment,
  EventAttachmentList,
  Issue,
  IssueList,
  OrganizationList,
  Project,
  ProjectList,
  ReleaseList,
  TagList,
  Team,
  TeamList,
  Trace,
  TraceMeta,
  User,
} from "./types";
// TODO: this is shared - so ideally, for safety, it uses @sentry/core, but currently
// logger isnt exposed (or rather, it is, but its not the right logger)
// import { logger } from "@sentry/node";

/**
 * Mapping of common network error codes to user-friendly messages.
 * These help users understand and resolve connection issues.
 */
const NETWORK_ERROR_MESSAGES: Record<string, string> = {
  EAI_AGAIN: "DNS temporarily unavailable. Check your internet connection.",
  ENOTFOUND: "Hostname not found. Verify the URL is correct.",
  ECONNREFUSED: "Connection refused. Ensure the service is accessible.",
  ETIMEDOUT: "Connection timed out. Check network connectivity.",
  ECONNRESET: "Connection reset. Try again in a moment.",
};

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
 * - Always uses HTTPS for secure connections
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
 * // Self-hosted instance with hostname
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
   * Always uses HTTPS for secure connections.
   *
   * @param config Configuration object
   * @param config.accessToken OAuth access token for authentication (optional for some endpoints)
   * @param config.host Sentry hostname (e.g. "sentry.io", "sentry.example.com")
   */
  constructor({
    accessToken = null,
    host = "sentry.io",
  }: {
    accessToken?: string | null;
    host?: string;
  }) {
    this.accessToken = accessToken;
    this.host = host;
    this.apiPrefix = `https://${host}/api/0`;
  }

  /**
   * Updates the host for API requests.
   *
   * Used for multi-region support or switching between Sentry instances.
   * Always uses HTTPS protocol.
   *
   * @param host New hostname to use for API requests
   */
  setHost(host: string) {
    this.host = host;
    this.apiPrefix = `https://${this.host}/api/0`;
  }

  /**
   * Checks if the current host is Sentry SaaS (sentry.io).
   *
   * Used to determine API endpoint availability and URL formats.
   * Self-hosted instances may not have all endpoints available.
   *
   * @returns True if using Sentry SaaS, false for self-hosted instances
   */
  private isSaas(): boolean {
    return isSentryHost(this.host);
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
      ? `https://${host}/api/0${path}`
      : `${this.apiPrefix}${path}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    };
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    // Check if fetch is available, otherwise provide a helpful error message
    if (typeof globalThis.fetch === "undefined") {
      throw new ConfigurationError(
        "fetch is not available. Please use Node.js >= 18 or ensure fetch is available in your environment.",
      );
    }

    // logger.info(logger.fmt`[sentryApi] ${options.method || "GET"} ${url}`);
    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
      });
    } catch (error) {
      // Extract the root cause from the error chain
      let rootCause = error;
      while (rootCause instanceof Error && rootCause.cause) {
        rootCause = rootCause.cause;
      }

      const errorMessage =
        rootCause instanceof Error ? rootCause.message : String(rootCause);

      let friendlyMessage = `Unable to connect to ${url}`;

      // Check if we have a specific message for this error
      const errorCode = Object.keys(NETWORK_ERROR_MESSAGES).find((code) =>
        errorMessage.includes(code),
      );

      if (errorCode) {
        friendlyMessage += ` - ${NETWORK_ERROR_MESSAGES[errorCode]}`;
      } else {
        friendlyMessage += ` - ${errorMessage}`;
      }

      // DNS resolution failures and connection timeouts to custom hosts are configuration issues
      if (
        errorCode === "ENOTFOUND" ||
        errorCode === "EAI_AGAIN" ||
        errorCode === "ECONNREFUSED" ||
        errorCode === "ETIMEDOUT" ||
        errorMessage.includes("Connect Timeout Error")
      ) {
        throw new ConfigurationError(friendlyMessage, { cause: error });
      }

      throw new Error(friendlyMessage, { cause: error });
    }

    // Handle error responses generically
    if (!response.ok) {
      const errorText = await response.text();
      let parsed: unknown | undefined;
      try {
        parsed = JSON.parse(errorText);
      } catch (error) {
        // If we can't parse JSON, check if it's HTML (server error)
        if (errorText.includes("<!DOCTYPE") || errorText.includes("<html")) {
          logWarn("Received HTML error page instead of JSON", {
            loggerScope: ["api", "client"],
            extra: {
              status: response.status,
              statusText: response.statusText,
              host: this.host,
              path,
              parseErrorMessage:
                error instanceof Error ? error.message : String(error),
            },
          });
          // HTML response instead of JSON typically indicates a server configuration issue
          throw createApiError(
            `Server error: Received HTML instead of JSON (${response.status} ${response.statusText}). This may indicate an invalid URL or server issue.`,
            response.status,
            errorText,
            undefined,
          );
        }
        logWarn("Failed to parse JSON error response", {
          loggerScope: ["api", "client"],
          extra: {
            status: response.status,
            statusText: response.statusText,
            host: this.host,
            path,
            bodyPreview:
              errorText.length > 256
                ? `${errorText.slice(0, 253)}…`
                : errorText,
            parseErrorMessage:
              error instanceof Error ? error.message : String(error),
          },
        });
      }

      if (parsed) {
        const { data, success, error } = ApiErrorSchema.safeParse(parsed);

        if (success) {
          // Use the new error factory to create the appropriate error type
          throw createApiError(
            data.detail,
            response.status,
            data.detail,
            parsed,
          );
        }

        logWarn("Failed to parse validated API error response", {
          loggerScope: ["api", "client"],
          extra: {
            status: response.status,
            statusText: response.statusText,
            host: this.host,
            path,
            bodyPreview:
              errorText.length > 256
                ? `${errorText.slice(0, 253)}…`
                : errorText,
            validationErrorMessage:
              error instanceof Error ? error.message : String(error),
          },
        });
      }

      // Use the error factory to create the appropriate error type based on status
      throw createApiError(
        `API request failed: ${response.statusText}\n${errorText}`,
        response.status,
        errorText,
        undefined,
      );
    }

    return response;
  }

  /**
   * Safely parses a JSON response, checking Content-Type header first.
   *
   * @param response The Response object from fetch
   * @returns Promise resolving to the parsed JSON object
   * @throws {Error} If response is not JSON or parsing fails
   */
  private async parseJsonResponse(response: Response): Promise<unknown> {
    // Handle case where response might not have all properties (e.g., in tests or promise chains)
    if (!response.headers?.get) {
      return response.json();
    }

    const contentType = response.headers.get("content-type");

    // Check if the response is JSON
    if (!contentType || !contentType.includes("application/json")) {
      const responseText = await response.text();

      // Check if it's HTML
      if (
        contentType?.includes("text/html") ||
        responseText.includes("<!DOCTYPE") ||
        responseText.includes("<html")
      ) {
        // HTML when expecting JSON usually indicates authentication or routing issues
        throw new Error(
          `Expected JSON response but received HTML (${response.status} ${response.statusText}). This may indicate you're not authenticated, the URL is incorrect, or there's a server issue.`,
        );
      }

      // Generic non-JSON error
      throw new Error(
        `Expected JSON response but received ${contentType || "unknown content type"} ` +
          `(${response.status} ${response.statusText})`,
      );
    }

    try {
      return await response.json();
    } catch (error) {
      // JSON parsing failure after successful response
      throw new Error(
        `Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Makes a request to the Sentry API and parses the JSON response.
   *
   * This is the primary method for API calls that expect JSON responses.
   * It automatically validates Content-Type and provides helpful error messages
   * for common issues like authentication failures or server errors.
   *
   * @param path API endpoint path (without /api/0 prefix)
   * @param options Fetch options
   * @param requestOptions Additional request configuration
   * @returns Promise resolving to the parsed JSON response
   * @throws {ApiError} Enhanced API errors with user-friendly messages
   * @throws {Error} Network, parsing, or validation errors
   */
  private async requestJSON(
    path: string,
    options: RequestInit = {},
    requestOptions?: { host?: string },
  ): Promise<unknown> {
    const response = await this.request(path, options, requestOptions);
    return this.parseJsonResponse(response);
  }

  /**
   * Generates a Sentry issue URL for browser navigation.
   *
   * Handles both SaaS (subdomain-based) and self-hosted URL formats.
   * Always uses HTTPS protocol.
   *
   * @param organizationSlug Organization identifier
   * @param issueId Issue identifier (short ID or numeric ID)
   * @returns Full URL to the issue in Sentry UI
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
    return getIssueUrlUtil(this.host, organizationSlug, issueId);
  }

  /**
   * Generates a Sentry trace URL for performance investigation.
   *
   * Always uses HTTPS protocol.
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
    return getTraceUrlUtil(this.host, organizationSlug, traceId);
  }

  // ================================================================================
  // URL BUILDERS FOR DIFFERENT SENTRY APIS
  // ================================================================================

  /**
   * Builds a URL for the legacy Discover API (used by errors dataset).
   *
   * The Discover API is the older query interface that includes aggregate
   * functions directly in the field list.
   *
   * @example
   * // URL format: /explore/discover/homepage/?field=title&field=count_unique(user)
   * buildDiscoverUrl("my-org", "level:error", "123", ["title", "count_unique(user)"], "-timestamp")
   */
  private buildDiscoverUrl(params: {
    organizationSlug: string;
    query: string;
    projectId?: string;
    fields?: string[];
    sort?: string;
    statsPeriod?: string;
    start?: string;
    end?: string;
    aggregateFunctions?: string[];
    groupByFields?: string[];
  }): string {
    const {
      organizationSlug,
      query,
      projectId,
      fields,
      sort,
      statsPeriod,
      start,
      end,
      aggregateFunctions,
      groupByFields,
    } = params;

    const urlParams = new URLSearchParams();

    // Discover API specific parameters
    urlParams.set("dataset", "errors");
    urlParams.set("queryDataset", "error-events");
    urlParams.set("query", query);

    if (projectId) {
      urlParams.set("project", projectId);
    }

    // Discover API includes aggregate functions directly in field list
    if (fields && fields.length > 0) {
      for (const field of fields) {
        urlParams.append("field", field);
      }
    } else {
      // Default fields for Discover
      urlParams.append("field", "title");
      urlParams.append("field", "project");
      urlParams.append("field", "user.display");
      urlParams.append("field", "timestamp");
    }

    urlParams.set("sort", sort || "-timestamp");

    // Add time parameters - either statsPeriod or start/end
    if (start && end) {
      urlParams.set("start", start);
      urlParams.set("end", end);
    } else {
      urlParams.set("statsPeriod", statsPeriod || "24h");
    }

    // Check if this is an aggregate query
    const isAggregate = (aggregateFunctions?.length ?? 0) > 0;
    if (isAggregate) {
      urlParams.set("mode", "aggregate");
      // For aggregate queries in Discover, set yAxis to the first aggregate function
      if (aggregateFunctions && aggregateFunctions.length > 0) {
        urlParams.set("yAxis", aggregateFunctions[0]);
      }
    } else {
      urlParams.set("yAxis", "count()");
    }

    // For SaaS instances, always use sentry.io for web UI URLs regardless of region
    // Regional subdomains (e.g., us.sentry.io) are only for API endpoints
    const webHost = this.isSaas() ? "sentry.io" : this.host;
    const path = this.isSaas()
      ? `https://${organizationSlug}.${webHost}/explore/discover/homepage/`
      : `https://${this.host}/organizations/${organizationSlug}/explore/discover/homepage/`;

    return `${path}?${urlParams.toString()}`;
  }

  /**
   * Builds a URL for the modern EAP (Event Analytics Platform) API used by spans/logs.
   *
   * The EAP API uses structured aggregate queries with separate aggregateField
   * parameters containing JSON objects for groupBy and yAxes.
   *
   * @example
   * // URL format: /explore/traces/?aggregateField={"groupBy":"span.op"}&aggregateField={"yAxes":["count()"]}
   * buildEapUrl("my-org", "span.op:db", "123", ["span.op", "count()"], "-count()", ["count()"], ["span.op"])
   */
  private buildEapUrl(params: {
    organizationSlug: string;
    query: string;
    dataset: "spans" | "logs";
    projectId?: string;
    fields?: string[];
    sort?: string;
    statsPeriod?: string;
    start?: string;
    end?: string;
    aggregateFunctions?: string[];
    groupByFields?: string[];
  }): string {
    const {
      organizationSlug,
      query,
      dataset,
      projectId,
      fields,
      sort,
      statsPeriod,
      start,
      end,
      aggregateFunctions,
      groupByFields,
    } = params;

    const urlParams = new URLSearchParams();
    urlParams.set("query", query);

    if (projectId) {
      urlParams.set("project", projectId);
    }

    // Determine if this is an aggregate query
    const isAggregateQuery =
      (aggregateFunctions?.length ?? 0) > 0 ||
      fields?.some((field) => field.includes("(") && field.includes(")")) ||
      false;

    if (isAggregateQuery) {
      // EAP API uses structured aggregate parameters
      if (
        (aggregateFunctions?.length ?? 0) > 0 ||
        (groupByFields?.length ?? 0) > 0
      ) {
        // Add each groupBy field as a separate aggregateField parameter
        if (groupByFields && groupByFields.length > 0) {
          for (const field of groupByFields) {
            urlParams.append(
              "aggregateField",
              JSON.stringify({ groupBy: field }),
            );
          }
        }

        // Add aggregate functions (yAxes)
        if (aggregateFunctions && aggregateFunctions.length > 0) {
          urlParams.append(
            "aggregateField",
            JSON.stringify({ yAxes: aggregateFunctions }),
          );
        }
      } else {
        // Fallback: parse fields to extract aggregate info
        const parsedGroupByFields =
          fields?.filter(
            (field) => !field.includes("(") && !field.includes(")"),
          ) || [];
        const parsedAggregateFunctions =
          fields?.filter(
            (field) => field.includes("(") && field.includes(")"),
          ) || [];

        for (const field of parsedGroupByFields) {
          urlParams.append(
            "aggregateField",
            JSON.stringify({ groupBy: field }),
          );
        }

        if (parsedAggregateFunctions.length > 0) {
          urlParams.append(
            "aggregateField",
            JSON.stringify({ yAxes: parsedAggregateFunctions }),
          );
        }
      }

      urlParams.set("mode", "aggregate");
    } else {
      // Non-aggregate query, add individual fields
      if (fields && fields.length > 0) {
        for (const field of fields) {
          urlParams.append("field", field);
        }
      }
    }

    // Add sort parameter for all queries
    if (sort) {
      urlParams.set("sort", sort);
    }

    // Add time parameters - either statsPeriod or start/end
    if (start && end) {
      urlParams.set("start", start);
      urlParams.set("end", end);
    } else {
      urlParams.set("statsPeriod", statsPeriod || "24h");
    }

    // Add table parameter for spans dataset (required for UI)
    if (dataset === "spans") {
      urlParams.set("table", "span");
    }

    const basePath = dataset === "logs" ? "logs" : "traces";
    // For SaaS instances, always use sentry.io for web UI URLs regardless of region
    // Regional subdomains (e.g., us.sentry.io) are only for API endpoints
    const webHost = this.isSaas() ? "sentry.io" : this.host;
    const path = this.isSaas()
      ? `https://${organizationSlug}.${webHost}/explore/${basePath}/`
      : `https://${this.host}/organizations/${organizationSlug}/explore/${basePath}/`;

    return `${path}?${urlParams.toString()}`;
  }

  /**
   * Generates a Sentry events explorer URL for viewing search results.
   *
   * Routes to the appropriate API based on dataset:
   * - Errors: Uses legacy Discover API
   * - Spans/Logs: Uses modern EAP (Event Analytics Platform) API
   *
   * @param organizationSlug Organization identifier
   * @param query Sentry search query
   * @param projectId Optional project filter
   * @param dataset Dataset type (spans, errors, or logs)
   * @param fields Array of fields to include in results
   * @param sort Sort parameter (e.g., "-timestamp", "-count()")
   * @param aggregateFunctions Array of aggregate functions (only used for EAP datasets)
   * @param groupByFields Array of fields to group by (only used for EAP datasets)
   * @param statsPeriod Relative time period (e.g., "24h", "7d")
   * @param start Absolute start time (ISO 8601)
   * @param end Absolute end time (ISO 8601)
   * @returns Full HTTPS URL to the events explorer in Sentry UI
   */
  getEventsExplorerUrl(
    organizationSlug: string,
    query: string,
    projectId?: string,
    dataset: "spans" | "errors" | "logs" = "spans",
    fields?: string[],
    sort?: string,
    aggregateFunctions?: string[],
    groupByFields?: string[],
    statsPeriod?: string,
    start?: string,
    end?: string,
  ): string {
    if (dataset === "errors") {
      // Route to legacy Discover API
      return this.buildDiscoverUrl({
        organizationSlug,
        query,
        projectId,
        fields,
        sort,
        statsPeriod,
        start,
        end,
        aggregateFunctions,
        groupByFields,
      });
    }

    // Route to modern EAP API (spans and logs)
    return this.buildEapUrl({
      organizationSlug,
      query,
      dataset,
      projectId,
      fields,
      sort,
      statsPeriod,
      start,
      end,
      aggregateFunctions,
      groupByFields,
    });
  }

  /**
   * Retrieves the authenticated user's profile information.
   *
   * @param opts Request options including host override
   * @returns User profile data
   * @throws {ApiError} If authentication fails or user not found
   */
  async getAuthenticatedUser(opts?: RequestOptions): Promise<User> {
    // Auth endpoints only exist on the main API server, never on regional endpoints
    let authHost: string | undefined;

    if (this.isSaas()) {
      // For SaaS, always use the main sentry.io host, not regional hosts
      // This handles cases like us.sentry.io, eu.sentry.io, etc.
      authHost = "sentry.io";
    }
    // For self-hosted, use the configured host (authHost remains undefined)

    const body = await this.requestJSON("/auth/", undefined, {
      ...opts,
      host: authHost,
    });
    return UserSchema.parse(body);
  }

  /**
   * Lists all organizations accessible to the authenticated user.
   *
   * Automatically handles multi-region queries by fetching from all
   * available regions and combining results.
   *
   * @param params Query parameters
   * @param params.query Search query to filter organizations by name/slug
   * @param opts Request options
   * @returns Array of organizations across all accessible regions (limited to 25 results)
   *
   * @example
   * ```typescript
   * const orgs = await apiService.listOrganizations();
   * orgs.forEach(org => {
   *   // regionUrl present for Cloud Service, empty for self-hosted
   *   console.log(`${org.name} (${org.slug}) - ${org.links?.regionUrl || 'No region URL'}`);
   * });
   * ```
   */
  async listOrganizations(
    params?: { query?: string },
    opts?: RequestOptions,
  ): Promise<OrganizationList> {
    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.set("per_page", "25");
    if (params?.query) {
      queryParams.set("query", params.query);
    }
    const queryString = queryParams.toString();
    const path = `/organizations/?${queryString}`;

    // For self-hosted instances, the regions endpoint doesn't exist
    if (!this.isSaas()) {
      const body = await this.requestJSON(path, undefined, opts);
      return OrganizationListSchema.parse(body);
    }

    // For SaaS, try to use regions endpoint first
    try {
      // TODO: Sentry is currently not returning all orgs without hitting region endpoints
      // The regions endpoint only exists on the main API server, not on regional endpoints
      const regionsBody = await this.requestJSON(
        "/users/me/regions/",
        undefined,
        {}, // Don't pass opts to ensure we use the main host
      );
      const regionData = UserRegionsSchema.parse(regionsBody);

      const allOrganizations = (
        await Promise.all(
          regionData.regions.map(async (region) =>
            this.requestJSON(path, undefined, {
              ...opts,
              host: new URL(region.url).host,
            }),
          ),
        )
      )
        .map((data) => OrganizationListSchema.parse(data))
        .reduce((acc, curr) => acc.concat(curr), []);

      // Apply the limit after combining results from all regions
      return allOrganizations.slice(0, 25);
    } catch (error) {
      // If regions endpoint fails (e.g., older self-hosted versions identifying as sentry.io),
      // fall back to direct organizations endpoint
      if (error instanceof ApiNotFoundError) {
        // logger.info("Regions endpoint not found, falling back to direct organizations endpoint");
        const body = await this.requestJSON(path, undefined, opts);
        return OrganizationListSchema.parse(body);
      }

      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Gets a single organization by slug.
   *
   * @param organizationSlug Organization identifier
   * @param opts Request options including host override
   * @returns Organization data
   */
  async getOrganization(organizationSlug: string, opts?: RequestOptions) {
    const body = await this.requestJSON(
      `/organizations/${organizationSlug}/`,
      undefined,
      opts,
    );
    return OrganizationSchema.parse(body);
  }

  /**
   * Lists teams within an organization.
   *
   * @param organizationSlug Organization identifier
   * @param params Query parameters
   * @param params.query Search query to filter teams by name/slug
   * @param opts Request options including host override
   * @returns Array of teams in the organization (limited to 25 results)
   */
  async listTeams(
    organizationSlug: string,
    params?: { query?: string },
    opts?: RequestOptions,
  ): Promise<TeamList> {
    const queryParams = new URLSearchParams();
    queryParams.set("per_page", "25");
    if (params?.query) {
      queryParams.set("query", params.query);
    }
    const queryString = queryParams.toString();
    const path = `/organizations/${organizationSlug}/teams/?${queryString}`;

    const body = await this.requestJSON(path, undefined, opts);
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
    const body = await this.requestJSON(
      `/organizations/${organizationSlug}/teams/`,
      {
        method: "POST",
        body: JSON.stringify({ name }),
      },
      opts,
    );
    return TeamSchema.parse(body);
  }

  /**
   * Lists projects within an organization.
   *
   * @param organizationSlug Organization identifier
   * @param params Query parameters
   * @param params.query Search query to filter projects by name/slug
   * @param opts Request options
   * @returns Array of projects in the organization (limited to 25 results)
   */
  async listProjects(
    organizationSlug: string,
    params?: { query?: string },
    opts?: RequestOptions,
  ): Promise<ProjectList> {
    const queryParams = new URLSearchParams();
    queryParams.set("per_page", "25");
    if (params?.query) {
      queryParams.set("query", params.query);
    }
    const queryString = queryParams.toString();
    const path = `/organizations/${organizationSlug}/projects/?${queryString}`;

    const body = await this.requestJSON(path, undefined, opts);
    return ProjectListSchema.parse(body);
  }

  /**
   * Gets a single project by slug or ID.
   *
   * @param params Project fetch parameters
   * @param params.organizationSlug Organization identifier
   * @param params.projectSlugOrId Project slug or numeric ID
   * @param opts Request options
   * @returns Project data
   */
  async getProject(
    {
      organizationSlug,
      projectSlugOrId,
    }: {
      organizationSlug: string;
      projectSlugOrId: string;
    },
    opts?: RequestOptions,
  ): Promise<Project> {
    const body = await this.requestJSON(
      `/projects/${organizationSlug}/${projectSlugOrId}/`,
      undefined,
      opts,
    );
    return ProjectSchema.parse(body);
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
    const body = await this.requestJSON(
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
    return ProjectSchema.parse(body);
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

    const body = await this.requestJSON(
      `/projects/${organizationSlug}/${projectSlug}/`,
      {
        method: "PUT",
        body: JSON.stringify(updateData),
      },
      opts,
    );
    return ProjectSchema.parse(body);
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
    const body = await this.requestJSON(
      `/projects/${organizationSlug}/${projectSlug}/keys/`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
        }),
      },
      opts,
    );
    return ClientKeySchema.parse(body);
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
    const body = await this.requestJSON(
      `/projects/${organizationSlug}/${projectSlug}/keys/`,
      undefined,
      opts,
    );
    return ClientKeyListSchema.parse(body);
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

    const body = await this.requestJSON(
      searchQuery.toString() ? `${path}?${searchQuery.toString()}` : path,
      undefined,
      opts,
    );
    return ReleaseListSchema.parse(body);
  }

  /**
   * Lists available tags for search queries.
   *
   * Tags represent indexed fields that can be used in Sentry search queries.
   *
   * @param params Query parameters
   * @param params.organizationSlug Organization identifier
   * @param params.dataset Dataset to query tags for ("events", "errors" or "search_issues")
   * @param params.project Numeric project ID to filter tags
   * @param params.statsPeriod Time range for tag statistics (e.g., "24h", "7d")
   * @param params.useCache Whether to use cached results
   * @param params.useFlagsBackend Whether to use flags backend features
   * @param opts Request options
   * @returns Array of available tags with metadata
   *
   * @example
   * ```typescript
   * const tags = await apiService.listTags({
   *   organizationSlug: "my-org",
   *   dataset: "events",
   *   project: "123456",
   *   statsPeriod: "24h",
   *   useCache: true
   * });
   * tags.forEach(tag => console.log(`${tag.key}: ${tag.name}`));
   * ```
   */
  async listTags(
    {
      organizationSlug,
      dataset,
      project,
      statsPeriod,
      start,
      end,
      useCache,
      useFlagsBackend,
    }: {
      organizationSlug: string;
      dataset?: "events" | "errors" | "search_issues";
      project?: string;
      statsPeriod?: string;
      start?: string;
      end?: string;
      useCache?: boolean;
      useFlagsBackend?: boolean;
    },
    opts?: RequestOptions,
  ): Promise<TagList> {
    const searchQuery = new URLSearchParams();
    if (dataset) {
      searchQuery.set("dataset", dataset);
    }
    if (project) {
      searchQuery.set("project", project);
    }
    // Validate time parameters - can't use both relative and absolute
    if (statsPeriod && (start || end)) {
      throw new ApiValidationError(
        "Cannot use both statsPeriod and start/end parameters. Use either statsPeriod for relative time or start/end for absolute time.",
      );
    }
    if ((start && !end) || (!start && end)) {
      throw new ApiValidationError(
        "Both start and end parameters must be provided together for absolute time ranges.",
      );
    }
    // Use either relative time (statsPeriod) or absolute time (start/end)
    if (statsPeriod) {
      searchQuery.set("statsPeriod", statsPeriod);
    } else if (start && end) {
      searchQuery.set("start", start);
      searchQuery.set("end", end);
    }
    if (useCache !== undefined) {
      searchQuery.set("useCache", useCache ? "1" : "0");
    }
    if (useFlagsBackend !== undefined) {
      searchQuery.set("useFlagsBackend", useFlagsBackend ? "1" : "0");
    }

    const body = await this.requestJSON(
      searchQuery.toString()
        ? `/organizations/${organizationSlug}/tags/?${searchQuery.toString()}`
        : `/organizations/${organizationSlug}/tags/`,
      undefined,
      opts,
    );
    return TagListSchema.parse(body);
  }

  /**
   * Lists trace item attributes available for search queries.
   *
   * Returns all available fields/attributes that can be used in event searches,
   * including both built-in fields and custom tags.
   *
   * @param params Query parameters
   * @param params.organizationSlug Organization identifier
   * @param params.itemType Item type to query attributes for ("spans" or "logs")
   * @param params.project Numeric project ID to filter attributes
   * @param params.statsPeriod Time range for attribute statistics (e.g., "24h", "7d")
   * @param opts Request options
   * @returns Array of available attributes with metadata including type
   */
  async listTraceItemAttributes(
    {
      organizationSlug,
      itemType = "spans",
      project,
      statsPeriod,
      start,
      end,
    }: {
      organizationSlug: string;
      itemType?: "spans" | "logs";
      project?: string;
      statsPeriod?: string;
      start?: string;
      end?: string;
    },
    opts?: RequestOptions,
  ): Promise<Array<{ key: string; name: string; type: "string" | "number" }>> {
    // Fetch both string and number attributes
    const [stringAttributes, numberAttributes] = await Promise.all([
      this.fetchTraceItemAttributesByType(
        organizationSlug,
        itemType,
        "string",
        project,
        statsPeriod,
        start,
        end,
        opts,
      ),
      this.fetchTraceItemAttributesByType(
        organizationSlug,
        itemType,
        "number",
        project,
        statsPeriod,
        start,
        end,
        opts,
      ),
    ]);

    // Combine attributes with explicit type information
    const allAttributes: Array<{
      key: string;
      name: string;
      type: "string" | "number";
    }> = [];

    // Add string attributes
    for (const attr of stringAttributes) {
      allAttributes.push({
        key: attr.key,
        name: attr.name || attr.key,
        type: "string",
      });
    }

    // Add number attributes
    for (const attr of numberAttributes) {
      allAttributes.push({
        key: attr.key,
        name: attr.name || attr.key,
        type: "number",
      });
    }

    return allAttributes;
  }

  private async fetchTraceItemAttributesByType(
    organizationSlug: string,
    itemType: "spans" | "logs",
    attributeType: "string" | "number",
    project?: string,
    statsPeriod?: string,
    start?: string,
    end?: string,
    opts?: RequestOptions,
  ): Promise<any> {
    const queryParams = new URLSearchParams();
    queryParams.set("itemType", itemType);
    queryParams.set("attributeType", attributeType);
    if (project) {
      queryParams.set("project", project);
    }
    // Validate time parameters - can't use both relative and absolute
    if (statsPeriod && (start || end)) {
      throw new ApiValidationError(
        "Cannot use both statsPeriod and start/end parameters. Use either statsPeriod for relative time or start/end for absolute time.",
      );
    }
    if ((start && !end) || (!start && end)) {
      throw new ApiValidationError(
        "Both start and end parameters must be provided together for absolute time ranges.",
      );
    }
    // Use either relative time (statsPeriod) or absolute time (start/end)
    if (statsPeriod) {
      queryParams.set("statsPeriod", statsPeriod);
    } else if (start && end) {
      queryParams.set("start", start);
      queryParams.set("end", end);
    }

    const url = `/organizations/${organizationSlug}/trace-items/attributes/?${queryParams.toString()}`;

    const body = await this.requestJSON(url, undefined, opts);
    return Array.isArray(body) ? body : [];
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
      limit = 10,
    }: {
      organizationSlug: string;
      projectSlug?: string;
      query?: string | null;
      sortBy?: "user" | "freq" | "date" | "new";
      limit?: number;
    },
    opts?: RequestOptions,
  ): Promise<IssueList> {
    const sentryQuery: string[] = [];
    if (query) {
      sentryQuery.push(query);
    }

    const queryParams = new URLSearchParams();
    queryParams.set("per_page", String(limit));
    if (sortBy) queryParams.set("sort", sortBy);
    queryParams.set("statsPeriod", "24h");
    queryParams.set("query", sentryQuery.join(" "));

    queryParams.append("collapse", "unhandled");

    const apiUrl = projectSlug
      ? `/projects/${organizationSlug}/${projectSlug}/issues/?${queryParams.toString()}`
      : `/organizations/${organizationSlug}/issues/?${queryParams.toString()}`;

    const body = await this.requestJSON(apiUrl, undefined, opts);
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
    const body = await this.requestJSON(
      `/organizations/${organizationSlug}/issues/${issueId}/`,
      undefined,
      opts,
    );
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
    const body = await this.requestJSON(
      `/organizations/${organizationSlug}/issues/${issueId}/events/${eventId}/`,
      undefined,
      opts,
    );
    const rawEvent = EventSchema.parse(body);

    // Filter out unknown events - only return known error/default/transaction types
    // "default" type represents error events without exception data
    if (rawEvent.type === "error" || rawEvent.type === "default") {
      return rawEvent as Event;
    }
    if (rawEvent.type === "transaction") {
      return rawEvent as Event;
    }

    const eventType =
      typeof rawEvent.type === "string" ? rawEvent.type : String(rawEvent.type);
    throw new ApiValidationError(
      `Unknown event type: ${eventType}`,
      400,
      `Only error, default, and transaction events are supported, got: ${eventType}`,
      body,
    );
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

  async listEventAttachments(
    {
      organizationSlug,
      projectSlug,
      eventId,
    }: {
      organizationSlug: string;
      projectSlug: string;
      eventId: string;
    },
    opts?: RequestOptions,
  ): Promise<EventAttachmentList> {
    const body = await this.requestJSON(
      `/projects/${organizationSlug}/${projectSlug}/events/${eventId}/attachments/`,
      undefined,
      opts,
    );
    return EventAttachmentListSchema.parse(body);
  }

  async getEventAttachment(
    {
      organizationSlug,
      projectSlug,
      eventId,
      attachmentId,
    }: {
      organizationSlug: string;
      projectSlug: string;
      eventId: string;
      attachmentId: string;
    },
    opts?: RequestOptions,
  ): Promise<{
    attachment: EventAttachment;
    downloadUrl: string;
    filename: string;
    blob: Blob;
  }> {
    // Get the attachment metadata first
    const attachmentsData = await this.requestJSON(
      `/projects/${organizationSlug}/${projectSlug}/events/${eventId}/attachments/`,
      undefined,
      opts,
    );

    const attachments = EventAttachmentListSchema.parse(attachmentsData);
    const attachment = attachments.find((att) => att.id === attachmentId);

    if (!attachment) {
      throw new ApiNotFoundError(
        `Attachment with ID ${attachmentId} not found for event ${eventId}`,
      );
    }

    // Download the actual file content
    const downloadUrl = `/projects/${organizationSlug}/${projectSlug}/events/${eventId}/attachments/${attachmentId}/?download=1`;
    const downloadResponse = await this.request(
      downloadUrl,
      {
        method: "GET",
        headers: {
          Accept: "application/octet-stream",
        },
      },
      opts,
    );

    return {
      attachment,
      downloadUrl: downloadResponse.url,
      filename: attachment.name,
      blob: await downloadResponse.blob(),
    };
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

    const body = await this.requestJSON(
      `/organizations/${organizationSlug}/issues/${issueId}/`,
      {
        method: "PUT",
        body: JSON.stringify(updateData),
      },
      opts,
    );
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

    const body = await this.requestJSON(apiUrl, undefined, opts);
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

    const body = await this.requestJSON(apiUrl, undefined, opts);
    return SpansSearchResponseSchema.parse(body).data;
  }

  // ================================================================================
  // API QUERY BUILDERS FOR DIFFERENT SENTRY APIS
  // ================================================================================

  /**
   * Builds query parameters for the legacy Discover API (primarily used by errors dataset).
   *
   * Note: While the API endpoint is the same for all datasets, we maintain separate
   * builders to make future divergence easier and to keep the code organized.
   */
  private buildDiscoverApiQuery(params: {
    query: string;
    fields: string[];
    limit: number;
    projectId?: string;
    statsPeriod?: string;
    start?: string;
    end?: string;
    sort: string;
  }): URLSearchParams {
    const queryParams = new URLSearchParams();

    // Basic parameters
    queryParams.set("per_page", params.limit.toString());
    queryParams.set("query", params.query);
    queryParams.set("dataset", "errors");

    // Validate time parameters - can't use both relative and absolute
    if (params.statsPeriod && (params.start || params.end)) {
      throw new ApiValidationError(
        "Cannot use both statsPeriod and start/end parameters. Use either statsPeriod for relative time or start/end for absolute time.",
      );
    }
    if ((params.start && !params.end) || (!params.start && params.end)) {
      throw new ApiValidationError(
        "Both start and end parameters must be provided together for absolute time ranges.",
      );
    }
    // Use either relative time (statsPeriod) or absolute time (start/end)
    if (params.statsPeriod) {
      queryParams.set("statsPeriod", params.statsPeriod);
    } else if (params.start && params.end) {
      queryParams.set("start", params.start);
      queryParams.set("end", params.end);
    }

    if (params.projectId) {
      queryParams.set("project", params.projectId);
    }

    // Sort parameter transformation for API compatibility
    let apiSort = params.sort;
    // Skip transformation for equation fields - they should be passed as-is
    if (params.sort?.includes("(") && !params.sort?.includes("equation|")) {
      // Transform: count(field) -> count_field, count() -> count
      // Use safer string manipulation to avoid ReDoS
      const parenStart = params.sort.indexOf("(");
      const parenEnd = params.sort.indexOf(")", parenStart);
      if (parenStart !== -1 && parenEnd !== -1) {
        const beforeParen = params.sort.substring(0, parenStart);
        const insideParen = params.sort.substring(parenStart + 1, parenEnd);
        const afterParen = params.sort.substring(parenEnd + 1);
        const transformedInside = insideParen
          ? `_${insideParen.replace(/\./g, "_")}`
          : "";
        apiSort = beforeParen + transformedInside + afterParen;
      }
    }
    queryParams.set("sort", apiSort);

    // Add fields
    for (const field of params.fields) {
      queryParams.append("field", field);
    }

    return queryParams;
  }

  /**
   * Builds query parameters for the modern EAP API (used by spans/logs datasets).
   *
   * Includes dataset-specific parameters like sampling for spans.
   */
  private buildEapApiQuery(params: {
    query: string;
    fields: string[];
    limit: number;
    projectId?: string;
    dataset: "spans" | "ourlogs";
    statsPeriod?: string;
    start?: string;
    end?: string;
    sort: string;
  }): URLSearchParams {
    const queryParams = new URLSearchParams();

    // Basic parameters
    queryParams.set("per_page", params.limit.toString());
    queryParams.set("query", params.query);
    queryParams.set("dataset", params.dataset);

    // Validate time parameters - can't use both relative and absolute
    if (params.statsPeriod && (params.start || params.end)) {
      throw new ApiValidationError(
        "Cannot use both statsPeriod and start/end parameters. Use either statsPeriod for relative time or start/end for absolute time.",
      );
    }
    if ((params.start && !params.end) || (!params.start && params.end)) {
      throw new ApiValidationError(
        "Both start and end parameters must be provided together for absolute time ranges.",
      );
    }
    // Use either relative time (statsPeriod) or absolute time (start/end)
    if (params.statsPeriod) {
      queryParams.set("statsPeriod", params.statsPeriod);
    } else if (params.start && params.end) {
      queryParams.set("start", params.start);
      queryParams.set("end", params.end);
    }

    if (params.projectId) {
      queryParams.set("project", params.projectId);
    }

    // Dataset-specific parameters
    if (params.dataset === "spans") {
      queryParams.set("sampling", "NORMAL");
    }

    // Sort parameter transformation for API compatibility
    let apiSort = params.sort;
    // Skip transformation for equation fields - they should be passed as-is
    if (params.sort?.includes("(") && !params.sort?.includes("equation|")) {
      // Transform: count(field) -> count_field, count() -> count
      // Use safer string manipulation to avoid ReDoS
      const parenStart = params.sort.indexOf("(");
      const parenEnd = params.sort.indexOf(")", parenStart);
      if (parenStart !== -1 && parenEnd !== -1) {
        const beforeParen = params.sort.substring(0, parenStart);
        const insideParen = params.sort.substring(parenStart + 1, parenEnd);
        const afterParen = params.sort.substring(parenEnd + 1);
        const transformedInside = insideParen
          ? `_${insideParen.replace(/\./g, "_")}`
          : "";
        apiSort = beforeParen + transformedInside + afterParen;
      }
    }
    queryParams.set("sort", apiSort);

    // Add fields
    for (const field of params.fields) {
      queryParams.append("field", field);
    }

    return queryParams;
  }

  /**
   * Searches for events in Sentry using the unified events API.
   * This method is used by the search_events tool for semantic search.
   *
   * Routes to the appropriate query builder based on dataset, even though
   * the underlying API endpoint is the same. This separation makes the code
   * cleaner and allows for future API divergence.
   */
  async searchEvents(
    {
      organizationSlug,
      query,
      fields,
      limit = 10,
      projectId,
      dataset = "spans",
      statsPeriod,
      start,
      end,
      sort = "-timestamp",
    }: {
      organizationSlug: string;
      query: string;
      fields: string[];
      limit?: number;
      projectId?: string;
      dataset?: "spans" | "errors" | "ourlogs";
      statsPeriod?: string;
      start?: string;
      end?: string;
      sort?: string;
    },
    opts?: RequestOptions,
  ) {
    let queryParams: URLSearchParams;

    if (dataset === "errors") {
      // Use Discover API query builder
      queryParams = this.buildDiscoverApiQuery({
        query,
        fields,
        limit,
        projectId,
        statsPeriod,
        start,
        end,
        sort,
      });
    } else {
      // Use EAP API query builder for spans and logs
      queryParams = this.buildEapApiQuery({
        query,
        fields,
        limit,
        projectId,
        dataset,
        statsPeriod,
        start,
        end,
        sort,
      });
    }

    const apiUrl = `/organizations/${organizationSlug}/events/?${queryParams.toString()}`;
    return await this.requestJSON(apiUrl, undefined, opts);
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
    const body = await this.requestJSON(
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
    const body = await this.requestJSON(
      `/organizations/${organizationSlug}/issues/${issueId}/autofix/`,
      undefined,
      opts,
    );
    return AutofixRunStateSchema.parse(body);
  }

  /**
   * Retrieves high-level metadata about a trace.
   *
   * Returns statistics including span counts, error counts, transaction
   * breakdown, and operation type distribution for the specified trace.
   *
   * @param params Query parameters
   * @param params.organizationSlug Organization identifier
   * @param params.traceId Trace identifier (32-character hex string)
   * @param params.statsPeriod Optional stats period (e.g., "14d", "7d")
   * @param opts Request options
   * @returns Trace metadata with statistics
   *
   * @example
   * ```typescript
   * const traceMeta = await apiService.getTraceMeta({
   *   organizationSlug: "my-org",
   *   traceId: "a4d1aae7216b47ff8117cf4e09ce9d0a"
   * });
   * console.log(`Trace has ${traceMeta.span_count} spans`);
   * ```
   */
  async getTraceMeta(
    {
      organizationSlug,
      traceId,
      statsPeriod = "14d",
    }: {
      organizationSlug: string;
      traceId: string;
      statsPeriod?: string;
    },
    opts?: RequestOptions,
  ): Promise<TraceMeta> {
    const queryParams = new URLSearchParams();
    queryParams.set("statsPeriod", statsPeriod);

    const body = await this.requestJSON(
      `/organizations/${organizationSlug}/trace-meta/${traceId}/?${queryParams.toString()}`,
      undefined,
      opts,
    );
    return TraceMetaSchema.parse(body);
  }

  /**
   * Retrieves the complete trace structure with all spans.
   *
   * Returns the hierarchical trace data including all spans, their timing
   * information, operation details, and nested relationships.
   *
   * @param params Query parameters
   * @param params.organizationSlug Organization identifier
   * @param params.traceId Trace identifier (32-character hex string)
   * @param params.limit Maximum number of spans to return (default: 1000)
   * @param params.project Project filter (-1 for all projects)
   * @param params.statsPeriod Optional stats period (e.g., "14d", "7d")
   * @param opts Request options
   * @returns Complete trace tree structure
   *
   * @example
   * ```typescript
   * const trace = await apiService.getTrace({
   *   organizationSlug: "my-org",
   *   traceId: "a4d1aae7216b47ff8117cf4e09ce9d0a",
   *   limit: 1000
   * });
   * console.log(`Root spans: ${trace.length}`);
   * ```
   */
  async getTrace(
    {
      organizationSlug,
      traceId,
      limit = 1000,
      project = "-1",
      statsPeriod = "14d",
    }: {
      organizationSlug: string;
      traceId: string;
      limit?: number;
      project?: string;
      statsPeriod?: string;
    },
    opts?: RequestOptions,
  ): Promise<Trace> {
    const queryParams = new URLSearchParams();
    queryParams.set("limit", String(limit));
    queryParams.set("project", project);
    queryParams.set("statsPeriod", statsPeriod);

    const body = await this.requestJSON(
      `/organizations/${organizationSlug}/trace/${traceId}/?${queryParams.toString()}`,
      undefined,
      opts,
    );
    return TraceSchema.parse(body);
  }
}
