/**
 * Direct MCP server communication for prompts functionality.
 *
 * Since the AI SDK's experimental MCP client doesn't support listPrompts(),
 * this module provides direct access to prompt definitions from the MCP server.
 */
import { PROMPT_DEFINITIONS } from "@sentry/mcp-server/promptDefinitions";
// HACK: We're importing prompt handlers directly because the AI SDK's experimental MCP client
// doesn't support prompt execution yet. Once the AI SDK adds support for prompts, we should
// use mcpClient.executePrompt() or similar instead of directly importing these.
import { PROMPT_HANDLERS } from "@sentry/mcp-server/prompts";
import type { z } from "zod";
import type { ServerContext } from "@sentry/mcp-server/types";

export interface PromptDefinition {
  name: string;
  description: string;
  paramsSchema: any; // We'll handle the complex union types in serialization
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
    paramsSchema: prompt.paramsSchema as any,
  }));
}

/**
 * Transform prompts into a format suitable for client consumption.
 * Converts Zod schemas to JSON schemas for easier client-side handling.
 */
export function serializePromptsForClient(prompts: PromptDefinition[]) {
  return prompts.map((prompt) => {
    const parameters: Record<string, any> = {};

    // Convert Zod schemas to a simpler format
    for (const [key, schema] of Object.entries(prompt.paramsSchema)) {
      if (schema && typeof schema === "object" && "_def" in schema) {
        parameters[key] = {
          type: getZodType(schema as z.ZodType<any>),
          required: !(schema as any).isOptional?.(),
          description: (schema as any)._def?.description || undefined,
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
 * Helper to extract type information from Zod schema.
 */
function getZodType(schema: z.ZodType<any>): string {
  const typeName = (schema as any)._def?.typeName;

  if (typeName === "ZodString") return "string";
  if (typeName === "ZodNumber") return "number";
  if (typeName === "ZodBoolean") return "boolean";
  if (typeName === "ZodArray") return "array";
  if (typeName === "ZodObject") return "object";
  if (typeName === "ZodOptional") {
    return getZodType((schema as any)._def.innerType);
  }
  return "string"; // default fallback
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
    console.error(`Failed to execute prompt handler ${promptName}:`, error);
    return null;
  }
}
