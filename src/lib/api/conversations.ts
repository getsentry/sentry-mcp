/**
 * AI Conversations API functions
 *
 * Functions for listing and retrieving AI conversation data from the Sentry
 * Explore AI-conversations endpoints.
 *
 * The `/organizations/{org}/ai-conversations/` endpoints are PRIVATE and not
 * yet in `@sentry/api` (getsentry/sentry-api-schema). Call them via
 * `apiRequestToRegion` with local Valibot schemas (same pattern as `logs.ts` /
 * `traces.ts`). Details response shape is documented on
 * `AIConversationDetailsSchema`. Pagination uses `parseLinkHeader`. Revisit
 * once these endpoints land in `@sentry/api`.
 */

import { array } from "valibot";

import {
  type AIConversationDetails,
  AIConversationDetailsSchema,
  type AIConversationSpan,
  type ConversationListItem,
  ConversationListItemSchema,
} from "../../types/conversation.js";

import { logger } from "../logger.js";
import { resolveOrgRegion } from "../region.js";

import {
  apiRequestToRegion,
  MAX_PAGINATION_PAGES,
  type PaginatedResponse,
  parseLinkHeader,
} from "./infrastructure.js";

const log = logger.withTag("api.conversations");

export async function listConversations(
  orgSlug: string,
  options: {
    query?: string;
    limit?: number;
    cursor?: string;
    statsPeriod?: string;
    start?: string;
    end?: string;
    project?: string;
  } = {}
): Promise<PaginatedResponse<ConversationListItem[]>> {
  const regionUrl = await resolveOrgRegion(orgSlug);

  const params: Record<string, string> = {
    per_page: String(options.limit ?? 10),
  };
  if (options.statsPeriod) {
    params.statsPeriod = options.statsPeriod;
  }
  if (options.start) {
    params.start = options.start;
  }
  if (options.end) {
    params.end = options.end;
  }
  if (options.cursor) {
    params.cursor = options.cursor;
  }
  if (options.query) {
    params.query = options.query;
  }
  if (options.project) {
    params.project = options.project;
  }

  const { data, headers } = await apiRequestToRegion<ConversationListItem[]>(
    regionUrl,
    `/organizations/${orgSlug}/ai-conversations/`,
    { params, schema: array(ConversationListItemSchema) }
  );

  const { nextCursor } = parseLinkHeader(headers.get("link") ?? null);

  return { data, nextCursor };
}

export async function getConversationSpans(
  orgSlug: string,
  conversationId: string,
  options: {
    statsPeriod?: string;
    project?: string;
    perPage?: number;
  } = {}
): Promise<{
  spans: AIConversationSpan[];
  truncated: boolean;
  title: string | null;
}> {
  const regionUrl = await resolveOrgRegion(orgSlug);

  const params: Record<string, string> = {
    per_page: String(options.perPage ?? 1000),
    statsPeriod: options.statsPeriod ?? "30d",
  };
  if (options.project) {
    params.project = options.project;
  }

  const spans: AIConversationSpan[] = [];
  let title: string | null = null;
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    if (cursor) {
      params.cursor = cursor;
    }

    const { data, headers } = await apiRequestToRegion<AIConversationDetails>(
      regionUrl,
      `/organizations/${orgSlug}/ai-conversations/${encodeURIComponent(conversationId)}/`,
      { params, schema: AIConversationDetailsSchema }
    );

    if (page === 0) {
      title = data.title;
    }
    spans.push(...data.spans);
    const parsed = parseLinkHeader(headers.get("link") ?? null);
    cursor = parsed.nextCursor;
    if (!cursor) {
      break;
    }
  }

  const truncated = !!cursor;
  if (truncated) {
    log.warn(
      `Pagination limit reached (${MAX_PAGINATION_PAGES} pages, ${spans.length} spans). Conversation transcript may be incomplete.`
    );
  }

  return { spans, truncated, title };
}
