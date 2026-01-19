/**
 * Sentry API Client
 *
 * Handles authenticated requests to the Sentry API.
 */

import type {
  SentryEvent,
  SentryIssue,
  SentryOrganization,
  SentryProject,
} from "../types/index.js";
import { getAuthToken } from "./config.js";

const SENTRY_API_BASE = "https://sentry.io/api/0";

/**
 * Pattern to detect short IDs (contain letters, vs numeric IDs which are just digits)
 */
const SHORT_ID_PATTERN = /[a-zA-Z]/;

// ─────────────────────────────────────────────────────────────────────────────
// Error Handling
// ─────────────────────────────────────────────────────────────────────────────

export class SentryApiError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = "SentryApiError";
    this.status = status;
    this.detail = detail;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Helpers
// ─────────────────────────────────────────────────────────────────────────────

type ApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
};

/**
 * Build URL with query parameters
 */
function buildUrl(
  endpoint: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${SENTRY_API_BASE}${endpoint}`;

  if (!params) {
    return url;
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }

  const queryString = searchParams.toString();
  return queryString ? `${url}?${queryString}` : url;
}

/**
 * Parse response body as JSON or text
 */
async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Get auth headers for requests
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();

  if (!token) {
    throw new SentryApiError(
      "Not authenticated. Run 'sentry auth login' first.",
      401
    );
  }

  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Request Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Make an authenticated request to the Sentry API
 */
export async function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const { method = "GET", body, params } = options;

  const url = buildUrl(endpoint, params);
  const headers = await getAuthHeaders();

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let detail: string | undefined;
    try {
      const errorBody = (await response.json()) as { detail?: string };
      detail = errorBody.detail ?? JSON.stringify(errorBody);
    } catch {
      detail = await response.text();
    }
    throw new SentryApiError(
      `API request failed: ${response.status} ${response.statusText}`,
      response.status,
      detail
    );
  }

  const body2 = await parseResponseBody(response);
  return body2 as T;
}

/**
 * Make a raw API request (for the 'sentry api' command)
 */
export async function rawApiRequest(
  endpoint: string,
  options: ApiRequestOptions & { headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const { method = "GET", body, params, headers: customHeaders = {} } = options;

  const url = buildUrl(endpoint, params);
  const headers = {
    ...(await getAuthHeaders()),
    ...customHeaders,
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseBody = await parseResponseBody(response);

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
