import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { USER_AGENT } from "../../version";

const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5";
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
