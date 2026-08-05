import {
  generateText,
  Output,
  type Tool,
  APICallError,
  NoObjectGeneratedError,
  RetryError,
  stepCountIs,
} from "ai";
import { getAgentProvider } from "./provider-factory";
import { UserInputError, LLMProviderError } from "../../errors";
import { logWarn } from "../../telem/logging";
import type { z } from "zod";

/**
 * Resolve the underlying provider failure from an AI SDK error.
 *
 * After retries, the SDK wraps retryable 5xx/network failures in RetryError.
 * Prefer the last error, then walk earlier errors for the first APICallError.
 */
function resolveProviderApiCallError(error: unknown): APICallError | null {
  if (APICallError.isInstance(error)) {
    return error;
  }

  if (!RetryError.isInstance(error)) {
    return null;
  }

  if (APICallError.isInstance(error.lastError)) {
    return error.lastError;
  }

  for (let i = error.errors.length - 1; i >= 0; i--) {
    const candidate = error.errors[i];
    if (APICallError.isInstance(candidate)) {
      return candidate;
    }
  }

  return null;
}

function toLLMProviderError(
  error: APICallError,
  originalError: unknown = error,
): LLMProviderError {
  // OpenAI region restriction error - provide specific helpful message
  if (error.message.includes("Country, region, or territory not supported")) {
    return new LLMProviderError(
      "The AI provider (OpenAI) does not support requests from your region. " +
        "This is a restriction imposed by OpenAI on certain countries and territories. " +
        "Please contact support if you believe this is an error.",
      { cause: originalError },
    );
  }

  const statusCode = error.statusCode;

  // 4xx: account/config/budget/rate-limit style failures
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return new LLMProviderError(
      `The AI provider returned an error: ${error.message}. This may be a configuration, quota, or account issue with the upstream AI provider.`,
      { cause: originalError },
    );
  }

  // 5xx / missing status (network, timeouts): treat as provider outage so
  // tool handlers can fall back instead of failing the parent MCP tool.
  if (!statusCode || statusCode >= 500) {
    return new LLMProviderError(
      `The AI provider is currently unavailable${statusCode ? ` (HTTP ${statusCode})` : ""}: ${error.message}. Please try again later.`,
      { cause: originalError },
    );
  }

  return new LLMProviderError(
    `The AI provider returned an error: ${error.message}. This may be a configuration, quota, or account issue with the upstream AI provider.`,
    { cause: originalError },
  );
}

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
  TSchema extends z.ZodType<TOutput, unknown>,
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

  // Get the configured provider (OpenAI, Azure OpenAI, or Anthropic)
  const provider = getAgentProvider();

  try {
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
    });

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
  } catch (error: unknown) {
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
          return { result: rescued, toolCalls: capturedToolCalls };
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

    // Handle LLM provider errors with user-friendly messages.
    // These are operational availability failures that should NOT create Sentry
    // issues per request (budget exhaustion, rate limits, provider outages).
    // Also unwrap RetryError: after maxRetries the AI SDK wraps retryable
    // 5xx/network failures so bare APICallError checks alone would miss them.
    const providerError = resolveProviderApiCallError(error);
    if (providerError) {
      throw toLLMProviderError(providerError, error);
    }

    // RetryError without an underlying APICallError is still a provider outage
    // (timeouts/network after retries) and should degrade the same way.
    if (RetryError.isInstance(error)) {
      throw new LLMProviderError(
        `The AI provider is currently unavailable: ${error.message}. Please try again later.`,
        { cause: error },
      );
    }

    // Re-throw unexpected errors to be handled by the caller (logged to Sentry)
    throw error;
  }
}

function extractBalancedJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (depth === 0) {
      if (ch === "{") {
        start = i;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

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
    if (inString) {
      continue;
    }

    if (ch === "{") {
      depth++;
      continue;
    }

    if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        objects.push(text.slice(start, i + 1));
        start = -1;
        inString = false;
        escaped = false;
      }
    }
  }

  return objects;
}

/**
 * Extract candidate JSON strings from text using multiple strategies.
 * Handles plain JSON, markdown code blocks, and embedded JSON objects.
 */
function extractJsonCandidates(text: string): string[] {
  const candidates = new Set<string>([text]);

  // Strategy 1: Extract from markdown code blocks (```json ... ``` or ``` ... ```)
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/g;
  const allMatches = Array.from(text.matchAll(codeBlockRegex));
  for (const match of allMatches) {
    candidates.add(match[1].trim());
  }

  // Strategy 2: Find balanced JSON objects anywhere in the text.
  for (const jsonObject of extractBalancedJsonObjects(text)) {
    candidates.add(jsonObject);
  }

  return Array.from(candidates);
}

/**
 * Attempt to rescue a failed structured output by parsing raw LLM text through the schema.
 * Schema defaults (e.g., `.default("")`) fill missing optional fields.
 * Handles plain JSON, markdown code blocks, and JSON embedded in prose (e.g., Anthropic responses).
 * Returns null if no candidate can be parsed or matched against the schema.
 */
function rescueFromText<TOutput>(
  text: string,
  schema: z.ZodType<TOutput, unknown>,
): TOutput | null {
  for (const candidate of extractJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      const result = schema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
    } catch {
      // Try next candidate
    }
  }
  return null;
}
