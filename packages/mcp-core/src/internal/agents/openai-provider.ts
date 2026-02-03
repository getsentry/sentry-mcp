import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { USER_AGENT } from "../../version";

// Default configuration constants
const DEFAULT_OPENAI_MODEL = "gpt-5";

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
 * Works with:
 * - OpenAI API directly (default)
 * - Any OpenAI-compatible API via custom base URL (Vercel AI Gateway, Azure OpenAI, etc.)
 *
 * Configuration:
 * - OPENAI_API_KEY: API key for authentication (required)
 * - OPENAI_MODEL: Model to use (default: "gpt-5") - env var OK
 * - Base URL: Must be set via setOpenAIBaseUrl() - NOT from env vars (security risk)
 *
 * Note: Model name format depends on your provider:
 * - Direct OpenAI: "gpt-4o", "gpt-4-turbo", etc.
 * - Vercel AI Gateway: "openai/gpt-4o", "anthropic/claude-sonnet-4.5", etc.
 * - Other providers: Check their documentation
 */
export function getOpenAIModel(model?: string): LanguageModel {
  const defaultModel = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;

  const factory = createOpenAI({
    ...(configuredBaseUrl && { baseURL: configuredBaseUrl }),
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  return factory(model ?? defaultModel);
}
