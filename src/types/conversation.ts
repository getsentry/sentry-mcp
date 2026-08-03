/**
 * AI Conversation types and Zod schemas.
 *
 * Schemas for the conversation list items and the raw conversation spans
 * returned by the Sentry Explore AI-conversations endpoints.
 */

import { z } from "zod";

export const ConversationListItemSchema = z.object({
  conversationId: z.string(),
  flow: z.array(z.string()),
  errors: z.number(),
  llmCalls: z.number(),
  toolCalls: z.number(),
  totalTokens: z.number(),
  totalCost: z.number(),
  startTimestamp: z.number(),
  endTimestamp: z.number(),
  traceCount: z.number(),
  traceIds: z.array(z.string()),
  firstInput: z.string().nullable(),
  lastOutput: z.string().nullable(),
  user: z
    .object({
      id: z.string().nullable(),
      email: z.string().nullable(),
      username: z.string().nullable(),
      ip_address: z.string().nullable(),
    })
    .nullable()
    .optional(),
  toolNames: z.array(z.string()),
  toolErrors: z.number(),
});

export type ConversationListItem = z.infer<typeof ConversationListItemSchema>;

const NullableString = z.string().nullable().optional();
const NullableStringOrNumber = z
  .union([z.string(), z.number()])
  .nullable()
  .optional();

export const AIConversationSpanSchema = z
  .object({
    "gen_ai.conversation.id": z.string(),
    span_id: z.string(),
    trace: z.string(),
    parent_span: z.string().nullable().optional(),
    "precise.start_ts": z.number(),
    "precise.finish_ts": z.number(),
    project: z.string(),
    "project.id": z.union([z.string(), z.number()]),
    "span.name": NullableString,
    "span.status": NullableString,
    "span.op": NullableString,
    "span.description": NullableString,
    "span.duration": z.number().optional(),
    transaction: NullableString,
    is_transaction: z.boolean().optional(),
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
  })
  .passthrough();

export type AIConversationSpan = z.infer<typeof AIConversationSpanSchema>;
