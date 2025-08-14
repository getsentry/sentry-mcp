/**
 * Core type system for MCP tools and prompts.
 *
 * Defines TypeScript types derived from tool/prompt definitions, handler signatures,
 * and server context. Uses advanced TypeScript patterns for type-safe parameter
 * extraction and handler registration.
 */
import type { PROMPT_DEFINITIONS } from "./promptDefinitions";
import type { z } from "zod";
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

export type PromptHandlerExtended<T extends PromptName> = (
  context: ServerContext,
  params: PromptParams<T>,
) => Promise<string>;

export type PromptHandlers = {
  [K in PromptName]: PromptHandlerExtended<K>;
};

/**
 * URL-based constraints that restrict the MCP session scope
 */
export type UrlConstraints = {
  organizationSlug?: string | null;
  projectSlug?: string | null;
};

export type ServerContext = {
  sentryHost?: string;
  mcpUrl?: string;
  accessToken: string;
  userId?: string | null;
  clientId?: string;
  // URL-based session constraints
  constraints: UrlConstraints;
  // MCP client information captured during initialization
  mcpClientName?: string;
  mcpClientVersion?: string;
  mcpProtocolVersion?: string;
};
