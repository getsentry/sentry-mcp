import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { USER_AGENT } from "../../version";
import type { ProviderOptions } from "./types";

const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.6-luna";
const DEFAULT_OPENROUTER_REASONING_EFFORT = "high";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Builds an OpenRouter chat-completions model for embedded agent calls.
 */
export function getOpenRouterModel(model?: string): LanguageModel {
  const factory = createOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
    headers: {
      "User-Agent": USER_AGENT,
      "HTTP-Referer": "https://github.com/getsentry/sentry-mcp",
      "X-OpenRouter-Title": "Sentry MCP",
    },
  });

  return factory.chat(
    model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL,
  );
}

/**
 * Provider options for OpenRouter chat-completions calls.
 *
 * Uses the OpenAI chat provider options shape because OpenRouter is accessed
 * through `@ai-sdk/openai` with an OpenRouter base URL.
 */
export function getOpenRouterProviderOptions(): ProviderOptions {
  const reasoningEffort =
    process.env.OPENROUTER_REASONING_EFFORT ??
    DEFAULT_OPENROUTER_REASONING_EFFORT;

  return {
    openai: {
      // Required for optional structured-output fields.
      // See: https://github.com/getsentry/sentry-mcp/issues/623
      structuredOutputs: false,
      strictJsonSchema: false,
      ...(reasoningEffort
        ? {
            reasoningEffort,
          }
        : {}),
    },
  };
}
