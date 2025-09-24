import { createOpenAI, openai as defaultOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";

let customFactory: ReturnType<typeof createOpenAI> | null = null;

/**
 * Configure the OpenAI provider factory.
 *
 * When a base URL is provided, the factory will use that endpoint for all
 * subsequent model requests. Passing undefined resets to the default
 * configuration bundled with the SDK.
 */
export function configureOpenAIProvider({
  baseUrl,
}: {
  baseUrl?: string;
}): void {
  if (baseUrl) {
    customFactory = createOpenAI({
      baseURL: baseUrl,
    });
    return;
  }
  customFactory = null;
}

/**
 * Retrieve a configured OpenAI language model.
 */
export function getOpenAIModel(model: string): LanguageModelV1 {
  const factory = customFactory ?? defaultOpenAI;
  return factory(model);
}
