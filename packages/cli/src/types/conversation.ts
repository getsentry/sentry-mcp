/**
 * AI Conversation types and Valibot schemas.
 *
 * Schemas for conversation list items, the details envelope, and raw
 * conversation spans returned by the Sentry Explore AI-conversations endpoints.
 */

import {
  array,
  boolean,
  type InferOutput,
  looseObject,
  nullable,
  number,
  object,
  optional,
  string,
  union,
} from "valibot";

export const ConversationListItemSchema = object({
  conversationId: string(),
  /** Stored conversation title when available (added by ai-monitoring list API). */
  title: optional(nullable(string())),
  flow: array(string()),
  errors: number(),
  llmCalls: number(),
  toolCalls: number(),
  totalTokens: number(),
  totalCost: number(),
  startTimestamp: number(),
  endTimestamp: number(),
  traceCount: number(),
  traceIds: array(string()),
  firstInput: nullable(string()),
  lastOutput: nullable(string()),
  user: optional(
    nullable(
      object({
        id: nullable(string()),
        email: nullable(string()),
        username: nullable(string()),
        ip_address: nullable(string()),
      })
    )
  ),
  toolNames: array(string()),
  toolErrors: number(),
});

export type ConversationListItem = InferOutput<
  typeof ConversationListItemSchema
>;

const NullableString = optional(nullable(string()));
const NullableStringOrNumber = optional(nullable(union([string(), number()])));

export const AIConversationSpanSchema = looseObject({
  "gen_ai.conversation.id": string(),
  span_id: string(),
  trace: string(),
  parent_span: optional(nullable(string())),
  "precise.start_ts": number(),
  "precise.finish_ts": number(),
  project: string(),
  "project.id": union([string(), number()]),
  "span.name": NullableString,
  "span.status": NullableString,
  "span.op": NullableString,
  "span.description": NullableString,
  "span.duration": optional(number()),
  transaction: NullableString,
  is_transaction: optional(boolean()),
  "gen_ai.cost.total_tokens": NullableStringOrNumber,
  "gen_ai.operation.type": NullableString,
  "gen_ai.input.messages": NullableString,
  "gen_ai.output.messages": NullableString,
  "gen_ai.system_instructions": NullableString,
  "gen_ai.tool.definitions": NullableString,
  "gen_ai.request.messages": NullableString,
  "gen_ai.response.object": NullableString,
  "gen_ai.response.text": NullableString,
  "gen_ai.tool.name": NullableString,
  "gen_ai.tool.call.arguments": NullableString,
  "gen_ai.tool.input": NullableString,
  "gen_ai.usage.total_tokens": NullableStringOrNumber,
  "gen_ai.request.model": NullableString,
  "gen_ai.response.model": NullableString,
  "gen_ai.agent.name": NullableString,
  "user.email": NullableString,
});

export type AIConversationSpan = InferOutput<typeof AIConversationSpanSchema>;

/**
 * Conversation details envelope returned by
 * `GET /organizations/{org}/ai-conversations/{conversationId}/`.
 *
 * As of getsentry/sentry#121143 the endpoint always returns this object
 * (conversation-level metadata + a page of spans) instead of a bare span
 * array. Pagination still uses the `Link` header; each page is an envelope
 * whose `spans` field holds that page's rows.
 */
export const AIConversationDetailsSchema = looseObject({
  conversationId: string(),
  title: nullable(string()),
  spans: array(AIConversationSpanSchema),
});

export type AIConversationDetails = InferOutput<
  typeof AIConversationDetailsSchema
>;
