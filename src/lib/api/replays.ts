/**
 * Replay API functions
 *
 * Functions for listing and retrieving Session Replays.
 */

import {
  type ListProjectReplayRecordingSegmentsResponse,
  listProjectReplayRecordingSegments,
} from "@sentry/api";
import { zListProjectReplayRecordingSegmentsResponse } from "@sentry/api/zod";
import type { z } from "zod";
import {
  REPLAY_LIST_FIELDS,
  type ReplayDetails,
  type ReplayDetailsResponse,
  ReplayDetailsResponseSchema,
  ReplayIdsByResourceSchema,
  type ReplayListItem,
  type ReplayListResponse,
  ReplayListResponseSchema,
} from "../../types/index.js";

import { ApiError } from "../errors.js";
import { resolveOrgRegion } from "../region.js";

import {
  API_MAX_PER_PAGE,
  apiRequestToRegion,
  autoPaginate,
  getOrgSdkConfig,
  MAX_PAGINATION_PAGES,
  type PaginatedResponse,
  parseLinkHeader,
  unwrapPaginatedResult,
} from "./infrastructure.js";

/** Replay sort field names supported by the backend replay index endpoint. */
export const REPLAY_SORT_FIELDS = [
  "activity",
  "browser",
  "browser.name",
  "browser.version",
  "count_dead_clicks",
  "count_errors",
  "count_infos",
  "count_rage_clicks",
  "count_screens",
  "count_urls",
  "count_warnings",
  "device.brand",
  "device.family",
  "device.model",
  "device.name",
  "dist",
  "duration",
  "finished_at",
  "os",
  "os.name",
  "os.version",
  "platform",
  "project_id",
  "sdk.name",
  "started_at",
  "user.email",
  "user.id",
  "user.username",
] as const;

/** Sort values supported by the backend replay index endpoint. */
export type ReplaySortField = (typeof REPLAY_SORT_FIELDS)[number];
export type ReplaySortValue = ReplaySortField | `-${ReplaySortField}`;

const REPLAY_SORT_VALUES = new Set<string>([
  ...REPLAY_SORT_FIELDS,
  ...REPLAY_SORT_FIELDS.map((field) => `-${field}`),
]);

/** Return whether a sort string is supported by the replay index endpoint. */
export function isReplaySortValue(value: string): value is ReplaySortValue {
  return REPLAY_SORT_VALUES.has(value);
}

/** Options for {@link listReplays}. */
export type ListReplaysOptions = {
  /** Limit total rows returned across auto-paginated pages. */
  limit?: number;
  /** Structured replay query using Sentry search syntax. */
  query?: string;
  /** Optional environment filter(s). */
  environment?: string[];
  /** Response fields to request from the replay endpoint. */
  fields?: string[];
  /** Project slugs to filter by. */
  projectSlugs?: string[];
  /** Sort expression for the replay index endpoint. */
  sort?: ReplaySortValue;
  /** Pagination cursor from a previous response. */
  cursor?: string;
  /** Relative time period (e.g. "7d", "24h"). Overrides start/end on the API. */
  statsPeriod?: string;
  /** Absolute start datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  start?: string;
  /** Absolute end datetime (ISO-8601). Mutually exclusive with statsPeriod. */
  end?: string;
};

type FetchReplayPageOptions = {
  options: ListReplaysOptions;
  perPage: number;
  cursor?: string;
};

type FetchReplayRecordingSegmentsPageOptions = {
  orgSlug: string;
  projectSlugOrId: string;
  replayId: string;
  cursor?: string;
};

/**
 * Validate the generated replay recording response before formatter code trusts
 * its object boundary. The SDK invokes response validators outside its normal
 * error-result path, so convert Zod failures to the CLI's API error type here.
 */
async function validateReplayRecordingSegmentsResponse(
  data: unknown
): Promise<void> {
  const result =
    await zListProjectReplayRecordingSegmentsResponse.safeParseAsync(data);
  if (!result.success) {
    throw new ApiError(
      "Unexpected replay recording segments response",
      0,
      result.error.message
    );
  }
}

/** Options for {@link getReplayRecordingSegments}. */
export type GetReplayRecordingSegmentsOptions = {
  /**
   * Soft stop hint: total segment count from replay metadata.
   *
   * Pagination stops as soon as this many segments have been fetched, even if
   * the API advertises another cursor. Because metadata can be slightly stale,
   * the result is NOT trimmed to this value — callers may receive more segments
   * than expected if the final page overshoots.
   *
   * Omit (or pass null/undefined) to fetch all pages up to MAX_PAGINATION_PAGES.
   */
  expectedSegments?: number | null;
};

/**
 * Coerce numeric project_id to string for consistent downstream handling.
 *
 * The replay API returns project_id as a number but the CLI and output
 * schemas normalize it to a string for uniform comparisons and display.
 */
function normalizeReplayProjectId<
  T extends { project_id?: string | number | null },
>(replay: T): T {
  if (
    replay.project_id === null ||
    replay.project_id === undefined ||
    typeof replay.project_id === "string"
  ) {
    return replay;
  }

  return {
    ...replay,
    project_id: String(replay.project_id),
  };
}

/**
 * Fetch a single page of replays from the organization replay index.
 */
async function fetchReplayPage(
  regionUrl: string,
  orgSlug: string,
  page: FetchReplayPageOptions
): Promise<PaginatedResponse<ReplayListItem[]>> {
  const { cursor, options, perPage } = page;
  const { data, headers } = await apiRequestToRegion(
    regionUrl,
    `/organizations/${orgSlug}/replays/`,
    {
      params: {
        cursor,
        environment: options.environment,
        field:
          options.fields && options.fields.length > 0
            ? options.fields
            : [...REPLAY_LIST_FIELDS],
        per_page: perPage,
        projectSlug: options.projectSlugs,
        query: options.query,
        sort: options.sort ?? "-started_at",
        statsPeriod:
          options.start || options.end
            ? undefined
            : (options.statsPeriod ?? "7d"),
        start: options.start,
        end: options.end,
      },
      schema: ReplayListResponseSchema as z.ZodType<ReplayListResponse>,
    }
  );

  const { nextCursor } = parseLinkHeader(headers.get("link") ?? null);
  return {
    data: data.data.map(normalizeReplayProjectId),
    nextCursor,
  };
}

/**
 * List replays for an organization, optionally filtered to one or more projects.
 *
 * Auto-paginates when `limit` exceeds the API's per-page cap.
 */
export async function listReplays(
  orgSlug: string,
  options: ListReplaysOptions = {}
): Promise<PaginatedResponse<ReplayListItem[]>> {
  const limit = options.limit ?? 25;
  const perPage = Math.min(limit, API_MAX_PER_PAGE);
  const regionUrl = await resolveOrgRegion(orgSlug);

  return autoPaginate(
    (cursor) =>
      fetchReplayPage(regionUrl, orgSlug, { options, perPage, cursor }),
    limit,
    options.cursor
  );
}

/**
 * Fetch a single replay by ID.
 */
export async function getReplay(
  orgSlug: string,
  replayId: string
): Promise<ReplayDetails> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion(
    regionUrl,
    `/organizations/${orgSlug}/replays/${replayId}/`,
    {
      schema: ReplayDetailsResponseSchema as z.ZodType<ReplayDetailsResponse>,
    }
  );
  return normalizeReplayProjectId(data.data);
}

/**
 * Fetch replay recording segments for a single replay.
 *
 * Uses the project-scoped replay endpoint because recording segments are
 * partitioned by project.
 *
 * Uses a manual pagination loop rather than {@link autoPaginate} because
 * `autoPaginate` trims results to `limit`, but `expectedSegments` is a soft
 * hint — trimming could silently drop real segments if metadata is stale.
 */
export async function getReplayRecordingSegments(
  orgSlug: string,
  projectSlugOrId: string,
  replayId: string,
  options: GetReplayRecordingSegmentsOptions = {}
): Promise<ListProjectReplayRecordingSegmentsResponse> {
  const expectedSegments = options.expectedSegments ?? Number.POSITIVE_INFINITY;
  const segments: ListProjectReplayRecordingSegmentsResponse = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGINATION_PAGES; page += 1) {
    const { data, nextCursor } = await fetchReplayRecordingSegmentsPage({
      orgSlug,
      projectSlugOrId,
      replayId,
      cursor,
    });

    segments.push(...data);

    if (segments.length >= expectedSegments || !nextCursor) {
      return segments;
    }

    cursor = nextCursor;
  }

  return segments;
}

/**
 * Fetch one SDK-backed recording page while preserving its cursor metadata.
 */
async function fetchReplayRecordingSegmentsPage(
  options: FetchReplayRecordingSegmentsPageOptions
): Promise<PaginatedResponse<ListProjectReplayRecordingSegmentsResponse>> {
  const { cursor, orgSlug, projectSlugOrId, replayId } = options;
  const config = await getOrgSdkConfig(orgSlug);
  const result = await listProjectReplayRecordingSegments({
    ...config,
    path: {
      organization_id_or_slug: orgSlug,
      project_id_or_slug: projectSlugOrId,
      replay_id: replayId,
    },
    query: {
      cursor,
      per_page: API_MAX_PER_PAGE,
    },
    responseValidator: validateReplayRecordingSegmentsResponse,
  });

  return unwrapPaginatedResult<ListProjectReplayRecordingSegmentsResponse>(
    result,
    "Failed to fetch replay recording segments"
  );
}

/**
 * List replay IDs related to a single issue.
 */
export async function listReplayIdsForIssue(
  orgSlug: string,
  issueId: string | number
): Promise<string[]> {
  const normalizedIssueId = String(issueId);
  const regionUrl = await resolveOrgRegion(orgSlug);
  const { data } = await apiRequestToRegion(
    regionUrl,
    `/organizations/${orgSlug}/replay-count/`,
    {
      params: {
        data_source: "events",
        project: "-1",
        query: `issue.id:[${normalizedIssueId}]`,
        returnIds: true,
        statsPeriod: "90d",
      },
      schema: ReplayIdsByResourceSchema,
    }
  );

  return data[normalizedIssueId] ?? [];
}
