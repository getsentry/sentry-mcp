import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { TOOL_DEFINITIONS } from "./toolDefinitions";
import type { PROMPT_DEFINITIONS } from "./promptDefinitions";
import type { z } from "zod";
import type { PromptCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";

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

export type PromptHandlers = {
  [K in PromptName]: PromptHandler<K>;
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
  extra: RequestHandlerExtra,
) => Promise<string>;

export type ToolHandlers = {
  [K in ToolName]: ToolHandlerExtended<K>;
};

export type ServerContext = {
  host?: string;
  accessToken: string;
  organizationSlug: string | null;
  userId?: string | null;
};
