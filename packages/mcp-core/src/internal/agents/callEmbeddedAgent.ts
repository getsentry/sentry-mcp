import {
  generateText,
  Output,
  type Tool,
  APICallError,
  NoObjectGeneratedError,
  stepCountIs,
} from "ai";
import { getAgentProvider } from "./provider-factory";
import { UserInputError, LLMProviderError } from "../../errors";
import { logWarn } from "../../telem/logging";
import type { z } from "zod";

export type ToolCall = {
  toolName: string;
  args: unknown;
};

interface EmbeddedAgentResult<T> {
  result: T;
  toolCalls: ToolCall[];
}

/**
 * Call an embedded agent with tool call capture
 * This is the standard way to call embedded AI agents within MCP tools
 *
 * Error handling:
 * - Errors are re-thrown for the calling agent to handle
 * - Each agent can implement its own error handling strategy
 */
export async function callEmbeddedAgent<
  TOutput,
  TSchema extends z.ZodType<TOutput, z.ZodTypeDef, unknown>,
>({
  system,
  prompt,
  tools,
  schema,
}: {
  system: string;
  prompt: string;
  tools: Record<string, Tool>;
  schema: TSchema;
}): Promise<EmbeddedAgentResult<TOutput>> {
  const capturedToolCalls: ToolCall[] = [];

  // Get the configured provider (OpenAI or Anthropic)
  const provider = getAgentProvider();

  const result = await generateText({
    model: provider.getModel(),
    system,
    prompt,
    tools,
    stopWhen: stepCountIs(5),
    experimental_output: Output.object({ schema }),
    experimental_telemetry: {
      isEnabled: true,
      functionId: "callEmbeddedAgent",
    },
    // Provider-specific options (e.g., OpenAI needs structuredOutputs: false)
    // See: https://github.com/getsentry/sentry-mcp/issues/623
    providerOptions: provider.getProviderOptions(),
    onStepFinish: (event) => {
      if (event.toolCalls && event.toolCalls.length > 0) {
        for (const toolCall of event.toolCalls) {
          capturedToolCalls.push({
            toolName: toolCall.toolName,
            args: toolCall.input,
          });
        }
      }
    },
  }).catch((error: unknown) => {
    // Rescue NoObjectGeneratedError: try to parse the raw LLM text through the schema
    // (schema defaults like .default("") fill missing fields)
    if (NoObjectGeneratedError.isInstance(error)) {
      if (error.text) {
        const rescued = rescueFromText(error.text, schema);
        if (rescued) {
          logWarn("NoObjectGeneratedError rescued via schema defaults", {
            loggerScope: ["agents", "embedded"],
            extra: {
              errorMessage: error.message,
              finishReason: error.finishReason,
            },
          });
          return rescued;
        }
      }
      logWarn("NoObjectGeneratedError could not be rescued", {
        loggerScope: ["agents", "embedded"],
        extra: {
          errorMessage: error.message,
          hasText: !!error.text,
          finishReason: error.finishReason,
        },
      });
      throw new UserInputError(
        "The AI was unable to process your query. Please try rephrasing.",
      );
    }

    // Handle LLM provider errors with user-friendly messages
    // These are user-facing errors that should NOT be reported to Sentry
    if (APICallError.isInstance(error)) {
      // OpenAI region restriction error - provide specific helpful message
      if (
        error.message.includes("Country, region, or territory not supported")
      ) {
        throw new LLMProviderError(
          "The AI provider (OpenAI) does not support requests from your region. " +
            "This is a restriction imposed by OpenAI on certain countries and territories. " +
            "Please contact support if you believe this is an error.",
        );
      }

      // All 4xx errors are user-facing (account issues, rate limits, invalid keys, etc.)
      // These should be shown to the user, not reported to Sentry
      const statusCode = error.statusCode;
      if (statusCode && statusCode >= 400 && statusCode < 500) {
        throw new LLMProviderError(
          `The AI provider returned an error: ${error.message}. This may be a configuration or account issue. Please check your AI provider settings.`,
        );
      }
    }
    // Re-throw 5xx and other errors to be handled by the caller (logged to Sentry)
    throw error;
  });

  // Rescued result from NoObjectGeneratedError - already validated through schema
  if ("rescued" in result) {
    return { result: result.rescued, toolCalls: capturedToolCalls };
  }

  if (!result.experimental_output) {
    throw new Error("Failed to generate output");
  }

  const rawOutput = result.experimental_output;

  if (
    typeof rawOutput === "object" &&
    rawOutput !== null &&
    "error" in rawOutput &&
    typeof (rawOutput as { error?: unknown }).error === "string"
  ) {
    throw new UserInputError((rawOutput as { error: string }).error);
  }

  const parsedResult = schema.safeParse(rawOutput);

  if (!parsedResult.success) {
    throw new UserInputError(
      `Invalid agent response: ${parsedResult.error.message}`,
    );
  }

  return {
    result: parsedResult.data,
    toolCalls: capturedToolCalls,
  };
}

/**
 * Find the first top-level JSON object in text using balanced brace matching.
 * Unlike a greedy regex, this stops at the correct closing } even when prose
 * after the object contains } characters (e.g. URL path params, code snippets).
 * Returns null if no balanced object is found.
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * Extract candidate JSON strings from text using multiple strategies.
 * Handles plain JSON, markdown code blocks, and embedded JSON objects.
 */
function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [text];

  // Strategy 1: Extract from markdown code blocks (```json ... ``` or ``` ... ```)
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/g;
  const allMatches = Array.from(text.matchAll(codeBlockRegex));
  for (const match of allMatches) {
    candidates.push(match[1].trim());
  }

  // Strategy 2: Find the first top-level JSON object using balanced brace matching.
  // A greedy regex like /\{[\s\S]*\}/ would stretch to the *last* } in the text,
  // breaking when prose after the JSON contains any } (e.g. code snippets, URL paths).
  const jsonObject = extractFirstJsonObject(text);
  if (jsonObject) {
    candidates.push(jsonObject);
  }

  return candidates;
}

/**
 * Attempt to rescue a failed structured output by parsing raw LLM text through the schema.
 * Schema defaults (e.g., `.default("")`) fill missing optional fields.
 * Handles plain JSON, markdown code blocks, and JSON embedded in prose (e.g., Anthropic responses).
 * Returns null if no candidate can be parsed or matched against the schema.
 */
function rescueFromText<TOutput>(
  text: string,
  schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>,
): { rescued: TOutput } | null {
  for (const candidate of extractJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      const result = schema.safeParse(parsed);
      if (result.success) {
        return { rescued: result.data };
      }
    } catch {
      // Try next candidate
    }
  }
  return null;
}
