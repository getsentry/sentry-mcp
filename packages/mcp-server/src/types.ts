/**
 * Core type system for MCP tools and prompts.
 *
 * Defines TypeScript types derived from tool/prompt definitions, handler signatures,
 * and server context. Uses advanced TypeScript patterns for type-safe parameter
 * extraction and handler registration.
 */
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { TOOL_DEFINITIONS } from "./toolDefinitions";
import type { PROMPT_DEFINITIONS } from "./promptDefinitions";
import type { z } from "zod";
import type {
  GetPromptResult,
  Notification,
} from "@modelcontextprotocol/sdk/types.js";

type ZodifyRecord<T extends Record<string, any>> = {
  [K in keyof T]: z.infer<T[K]>;
};
export type PromptName = (typeof PROMPT_DEFINITIONS)[number]["name"];

export type PromptDefinition<T extends PromptName> = Extract<
  (typeof PROMPT_DEFINITIONS)[number],
  { name: T }
>;

export type PromptParams<T extends PromptName> = PromptDefinition<T> extends {
  paramsSchema: Record<string, any>;
}
  ? ZodifyRecord<PromptDefinition<T>["paramsSchema"]>
  : Record<string, never>;

export type PromptHandler<T extends PromptName> = (
  params: PromptParams<T>,
) => Promise<GetPromptResult>;

export type PromptHandlerExtended<T extends PromptName> = (
  context: ServerContext,
  params: PromptParams<T>,
) => Promise<string>;

export type PromptHandlers = {
  [K in PromptName]: PromptHandlerExtended<K>;
};

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export type ToolDefinition<T extends ToolName> = Extract<
  (typeof TOOL_DEFINITIONS)[number],
  { name: T }
>;

export type ToolParams<T extends ToolName> = ToolDefinition<T> extends {
  paramsSchema: Record<string, any>;
}
  ? ZodifyRecord<ToolDefinition<T>["paramsSchema"]>
  : Record<string, never>;

export type ToolHandler<T extends ToolName> = (
  params: ToolParams<T>,
) => Promise<string>;

export type ToolHandlerExtended<T extends ToolName> = (
  context: ServerContext,
  params: ToolParams<T>,
  extra: RequestHandlerExtra<Request, Notification>,
) => Promise<string>;

export type ToolHandlers = {
  [K in ToolName]: ToolHandlerExtended<K>;
};

export type ServerContext = {
  host?: string;
  accessToken: string;
  organizationSlug: string | null;
  userId?: string | null;
  clientId?: string;
};
