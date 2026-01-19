/**
 * Sentry API Client
 *
 * Handles authenticated requests to the Sentry API.
 * Uses ky for retry logic, timeouts, and better error handling.
 */

import ky, { type KyInstance } from "ky";
import type {
  SentryEvent,
  SentryIssue,
  SentryOrganization,
  SentryProject,
} from "../types/index.js";
import { getAuthToken } from "./config.js";
import { ApiError, AuthError } from "./errors.js";

const DEFAULT_SENTRY_URL = "https://sentry.io";

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 30_000;

/** Maximum retry attempts for failed requests */
const MAX_RETRIES = 2;

/** Maximum backoff delay between retries in milliseconds */
const MAX_BACKOFF_MS = 10_000;

/** HTTP status codes that trigger automatic retry */
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Get the Sentry API base URL.
 * Supports self-hosted instances via SENTRY_URL env var.
 */
function getApiBaseUrl(): string {
  const baseUrl = process.env.SENTRY_URL || DEFAULT_SENTRY_URL;
  return `${baseUrl}/api/0/`;
}

/**
 * Normalize endpoint path for use with ky's prefixUrl.
 * Removes leading slash since ky handles URL joining.
 */
function normalizePath(endpoint: string): string {
  return endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
}

/**
 * Pattern to detect short IDs (contain letters, vs numeric IDs which are just digits)
 */
const SHORT_ID_PATTERN = /[a-zA-Z]/;

// ─────────────────────────────────────────────────────────────────────────────
// Request Helpers
// ─────────────────────────────────────────────────────────────────────────────

type ApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
};

/**
 * Create a configured ky instance with retry, timeout, and authentication.
 *
 * @throws {AuthError} When not authenticated
 * @throws {ApiError} When API request fails
 */
async function createApiClient(): Promise<KyInstance> {
  const token = await getAuthToken();

  if (!token) {
    throw new AuthError("not_authenticated");
  }

  return ky.create({
    prefixUrl: getApiBaseUrl(),
    timeout: REQUEST_TIMEOUT_MS,
    retry: {
      limit: MAX_RETRIES,
      methods: ["get", "put", "delete", "patch"],
      statusCodes: RETRYABLE_STATUS_CODES,
      backoffLimit: MAX_BACKOFF_MS,
    },
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    hooks: {
      beforeError: [
        async (error) => {
          const { response } = error;
          if (response) {
            const text = await response.text();
            let detail: string | undefined;
            try {
              const body = JSON.parse(text) as { detail?: string };
              detail = body.detail ?? JSON.stringify(body);
            } catch {
              detail = text;
            }
            throw new ApiError(
              `API request failed: ${response.status} ${response.statusText}`,
              response.status,
              detail
            );
          }
          return error;
        },
      ],
    },
  });
}

/**
 * Build URLSearchParams from an options object, filtering out undefined values.
 *
 * @param params - Key-value pairs to convert to search params
 * @returns URLSearchParams instance, or undefined if no valid params
 */
function buildSearchParams(
  params?: Record<string, string | number | boolean | undefined>
): URLSearchParams | undefined {
  if (!params) {
    return;
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }

  return searchParams.toString() ? searchParams : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Request Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Make an authenticated request to the Sentry API.
 *
 * @param endpoint - API endpoint path (e.g., "/organizations/")
 * @param options - Request options including method, body, and query params
 * @returns Parsed JSON response
 * @throws {AuthError} When not authenticated
 * @throws {ApiError} On API errors
 */
export async function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const { method = "GET", body, params } = options;
  const client = await createApiClient();

  const response = await client(normalizePath(endpoint), {
    method,
    json: body,
    searchParams: buildSearchParams(params),
  });

  return response.json<T>();
}

/**
 * Make a raw API request that returns full response details.
 * Unlike apiRequest, this does not throw on non-2xx responses.
 * Used by the 'sentry api' command for direct API access.
 *
 * @param endpoint - API endpoint path (e.g., "/organizations/")
 * @param options - Request options including method, body, params, and custom headers
 * @returns Response status, headers, and parsed body
 * @throws {AuthError} Only on authentication failure (not on API errors)
 */
export async function rawApiRequest(
  endpoint: string,
  options: ApiRequestOptions & { headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const { method = "GET", body, params, headers: customHeaders = {} } = options;
  const client = await createApiClient();

  const response = await client(normalizePath(endpoint), {
    method,
    json: body,
    searchParams: buildSearchParams(params),
    headers: customHeaders,
    throwHttpErrors: false,
  });

  const text = await response.text();
  let responseBody: unknown;
  try {
    responseBody = JSON.parse(text);
  } catch {
    responseBody = text;
  }

  return {
    status: response.status,
    headers: response.headers,
    body: responseBody,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// High-level API Methods
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List organizations the user has access to
 */
export function listOrganizations(): Promise<SentryOrganization[]> {
  return apiRequest<SentryOrganization[]>("/organizations/");
}

/**
 * Get a specific organization
 */
export function getOrganization(orgSlug: string): Promise<SentryOrganization> {
  return apiRequest<SentryOrganization>(`/organizations/${orgSlug}/`);
}

/**
 * List projects in an organization
 */
export function listProjects(orgSlug: string): Promise<SentryProject[]> {
  return apiRequest<SentryProject[]>(`/organizations/${orgSlug}/projects/`);
}

/**
 * Get a specific project
 */
export function getProject(
  orgSlug: string,
  projectSlug: string
): Promise<SentryProject> {
  return apiRequest<SentryProject>(`/projects/${orgSlug}/${projectSlug}/`);
}

/**
 * List issues for a project
 */
export function listIssues(
  orgSlug: string,
  projectSlug: string,
  options: {
    query?: string;
    cursor?: string;
    limit?: number;
    sort?: "date" | "new" | "priority" | "freq" | "user";
    statsPeriod?: string;
  } = {}
): Promise<SentryIssue[]> {
  return apiRequest<SentryIssue[]>(
    `/projects/${orgSlug}/${projectSlug}/issues/`,
    {
      params: {
        query: options.query,
        cursor: options.cursor,
        limit: options.limit,
        sort: options.sort,
        statsPeriod: options.statsPeriod,
      },
    }
  );
}

/**
 * Get a specific issue by numeric ID
 */
export function getIssue(issueId: string): Promise<SentryIssue> {
  return apiRequest<SentryIssue>(`/issues/${issueId}/`);
}

/**
 * Get an issue by short ID (e.g., SPOTLIGHT-ELECTRON-4D)
 * Requires organization context to resolve the short ID
 *
 * @see https://docs.sentry.io/api/events/retrieve-an-issue/
 */
export function getIssueByShortId(
  orgSlug: string,
  shortId: string
): Promise<SentryIssue> {
  return apiRequest<SentryIssue>(
    `/organizations/${orgSlug}/issues/${shortId}/`
  );
}

/**
 * Check if a string looks like a short ID (e.g., PROJECT-ABC)
 * vs a numeric ID (e.g., 123456)
 */
export function isShortId(issueId: string): boolean {
  // Short IDs contain letters and hyphens, numeric IDs are just digits
  return SHORT_ID_PATTERN.test(issueId);
}

/**
 * Get the latest event for an issue
 */
export function getLatestEvent(issueId: string): Promise<SentryEvent> {
  return apiRequest<SentryEvent>(`/issues/${issueId}/events/latest/`);
}

/**
 * Get a specific event by ID
 * @see https://docs.sentry.io/api/events/retrieve-an-event-for-a-project/
 */
export function getEvent(
  orgSlug: string,
  projectSlug: string,
  eventId: string
): Promise<SentryEvent> {
  return apiRequest<SentryEvent>(
    `/projects/${orgSlug}/${projectSlug}/events/${eventId}/`
  );
}

/**
 * Update an issue's status
 */
export function updateIssueStatus(
  issueId: string,
  status: "resolved" | "unresolved" | "ignored"
): Promise<SentryIssue> {
  return apiRequest<SentryIssue>(`/issues/${issueId}/`, {
    method: "PUT",
    body: { status },
  });
}
