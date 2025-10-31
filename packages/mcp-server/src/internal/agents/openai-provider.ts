import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";

// Create a default factory with User-Agent header
const defaultFactory = createOpenAI({
  headers: {
    "User-Agent": "Sentry MCP Server",
  },
});

let customFactory: ReturnType<typeof createOpenAI> | null = null;
let defaultModel = "gpt-5";

/**
 * Configure the OpenAI provider factory.
 *
 * When a base URL is provided, the factory will use that endpoint for all
 * subsequent model requests. Passing undefined resets to the default
 * configuration bundled with the SDK.
 *
 * When a default model is provided, it will be used as the default for all
 * subsequent getOpenAIModel() calls. Passing undefined resets to "gpt-5".
 */
export function configureOpenAIProvider({
  baseUrl,
  defaultModel: model,
}: {
  baseUrl?: string;
  defaultModel?: string;
}): void {
  if (baseUrl) {
    customFactory = createOpenAI({
      baseURL: baseUrl,
      headers: {
        "User-Agent": "Sentry MCP Server",
      },
    });
  } else {
    customFactory = null;
  }

  if (model !== undefined) {
    defaultModel = model;
  }
}

/**
 * Retrieve a configured OpenAI language model.
 * If no model is specified, uses the configured default model (gpt-5).
 */
export function getOpenAIModel(model?: string): LanguageModelV1 {
  const factory = customFactory ?? defaultFactory;
  return factory(model ?? defaultModel);
}
