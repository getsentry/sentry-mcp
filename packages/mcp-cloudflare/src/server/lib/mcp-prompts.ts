/**
 * Direct MCP server communication for prompts functionality.
 *
 * Since the AI SDK's experimental MCP client doesn't support listPrompts(),
 * this module provides direct access to prompt definitions from the MCP server.
 */
import PROMPT_DEFINITIONS from "@sentry/mcp-server/promptDefinitions";
// HACK: We're importing prompt handlers directly because the AI SDK's experimental MCP client
// doesn't support prompt execution yet. Once the AI SDK adds support for prompts, we should
// use mcpClient.executePrompt() or similar instead of directly importing these.
import { PROMPT_HANDLERS } from "@sentry/mcp-server/prompts";
import type { ServerContext } from "@sentry/mcp-server/types";
import { logIssue } from "@sentry/mcp-server/logging";

export interface PromptDefinition {
  name: string;
  description: string;
  // JSON Schema for parameters
  inputSchema: unknown;
}

/**
 * Get all available prompts from the MCP server.
 *
 * This is a direct implementation since the AI SDK MCP client
 * doesn't support prompts yet.
 */
export function getMcpPrompts(): PromptDefinition[] {
  return PROMPT_DEFINITIONS.map((prompt) => ({
    name: prompt.name,
    description: prompt.description,
    inputSchema: prompt.inputSchema,
  }));
}

/**
 * Transform prompts into a format suitable for client consumption.
 * Converts Zod schemas to JSON schemas for easier client-side handling.
 */
export function serializePromptsForClient(prompts: PromptDefinition[]) {
  return prompts.map((prompt) => {
    const schema = prompt.inputSchema as
      | {
          properties?: Record<
            string,
            { type?: string | string[]; description?: string } | undefined
          >;
          required?: string[];
        }
      | undefined;

    const parameters: Record<string, any> = {};
    if (schema?.properties) {
      const req = new Set(schema.required ?? []);
      for (const [key, prop] of Object.entries(schema.properties)) {
        parameters[key] = {
          type: (prop?.type ?? "string") as string | string[],
          required: req.has(key),
          description: prop?.description,
        };
      }
    }

    return {
      name: prompt.name,
      description: prompt.description,
      parameters,
    };
  });
}

/**
 * Execute a prompt handler to get the filled template.
 * This generates the instruction text that guides the LLM.
 */
export async function executePromptHandler(
  promptName: string,
  parameters: Record<string, any>,
  context: ServerContext,
): Promise<string | null> {
  const handler = PROMPT_HANDLERS[promptName as keyof typeof PROMPT_HANDLERS];
  if (!handler) {
    return null;
  }

  try {
    return await handler(context, parameters as any);
  } catch (error) {
    logIssue(error, {
      loggerScope: ["cloudflare", "mcp-prompts"],
      contexts: {
        prompt: {
          name: promptName,
        },
      },
    });
    return null;
  }
}
