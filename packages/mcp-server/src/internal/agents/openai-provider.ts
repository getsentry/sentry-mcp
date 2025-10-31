import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";

// Default configuration constants
const DEFAULT_OPENAI_MODEL = "gpt-5";
const DEFAULT_REASONING_EFFORT = "low" as const;

// Module-level state for baseURL (set only via explicit configuration, not env vars)
let configuredBaseUrl: string | undefined;

/**
 * Configure the OpenAI base URL (CLI flag only, not environment variable).
 * This must be called explicitly - it cannot be set via environment variables for security.
 */
export function setOpenAIBaseUrl(baseUrl: string | undefined): void {
  configuredBaseUrl = baseUrl;
}

/**
 * Retrieve an OpenAI language model configured from environment variables and explicit config.
 *
 * Configuration:
 * - OPENAI_MODEL: Model to use (default: "gpt-5") - env var OK
 * - OPENAI_REASONING_EFFORT: Reasoning effort for o1 models: "low", "medium", "high" (default: "low") - env var OK
 * - Base URL: Must be set via setOpenAIBaseUrl() - NOT from env vars (security risk)
 */
export function getOpenAIModel(model?: string): LanguageModelV1 {
  const defaultModel = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const reasoningEffort =
    (process.env.OPENAI_REASONING_EFFORT as
      | "low"
      | "medium"
      | "high"
      | undefined) || DEFAULT_REASONING_EFFORT;

  const factory = createOpenAI({
    ...(configuredBaseUrl && { baseURL: configuredBaseUrl }),
    headers: {
      "User-Agent": "Sentry MCP Server",
    },
  });

  return factory(model ?? defaultModel, {
    ...(reasoningEffort && { reasoningEffort }),
  });
}
