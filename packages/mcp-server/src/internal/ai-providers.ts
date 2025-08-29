import { createProviderRegistry } from "ai";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { google, createGoogleGenerativeAI } from "@ai-sdk/google";
import { xai, createXai } from "@ai-sdk/xai";

/**
 * Creates an AI provider registry configured from environment variables
 * 
 * Supported environment variables:
 * - AI_SDK_MODEL: Model identifier (e.g., "gpt-5", "claude-sonnet-4-20250514", "gemini-2.5-flash", "grok-4")
 * - OPENAI_API_KEY: OpenAI API key (for GPT-5, GPT-4o models)
 * - ANTHROPIC_API_KEY: Anthropic API key (for Claude Sonnet 4)
 * - GOOGLE_GENERATIVE_AI_API_KEY: Google AI API key (for Gemini 2.5 Flash)
 * - XAI_API_KEY: xAI API key (for Grok models)
 * - AI_SDK_BASE_URL: Custom base URL for OpenAI-compatible providers (with OPENAI_API_KEY)
 */
export function createAIRegistry() {
  const providers: Record<string, any> = {};

  // OpenAI provider (or custom OpenAI-compatible provider)
  if (process.env.OPENAI_API_KEY) {
    if (process.env.AI_SDK_BASE_URL) {
      // Custom OpenAI-compatible provider (e.g., OpenRouter, local LLM)
      providers.openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.AI_SDK_BASE_URL,
      });
    } else {
      // Standard OpenAI
      providers.openai = openai;
    }
  }

  // Anthropic provider
  if (process.env.ANTHROPIC_API_KEY) {
    providers.anthropic = anthropic;
  }

  // Google provider
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    providers.google = google;
  }

  // xAI provider
  if (process.env.XAI_API_KEY) {
    providers.xai = xai;
  }

  if (Object.keys(providers).length === 0) {
    throw new Error(
      "No AI provider configured. Please set at least one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or XAI_API_KEY"
    );
  }

  return createProviderRegistry(providers);
}

/**
 * Gets a model from the registry using environment configuration
 * 
 * @param modelOverride Optional model identifier to override AI_SDK_MODEL
 * @returns Language model instance
 */
export function getConfiguredModel(modelOverride?: string) {
  const registry = createAIRegistry();
  const modelId = modelOverride || process.env.AI_SDK_MODEL || "openai:gpt-4o";
  
  // Handle model identifiers without provider prefix
  let fullModelId = modelId;
  if (!modelId.includes(":")) {
    // Auto-detect provider based on model name patterns
    if (modelId.startsWith("claude") || modelId.includes("sonnet")) {
      fullModelId = `anthropic:${modelId}`;
    } else if (modelId.startsWith("gemini")) {
      fullModelId = `google:${modelId}`;
    } else if (modelId.startsWith("grok")) {
      fullModelId = `xai:${modelId}`;
    } else if (modelId.startsWith("gpt")) {
      fullModelId = `openai:${modelId}`;
    } else {
      // Default to OpenAI for unprefixed models
      fullModelId = `openai:${modelId}`;
    }
  }

  try {
    return registry.languageModel(fullModelId as `${string}:${string}`);
  } catch (error) {
    throw new Error(
      `Failed to load model "${fullModelId}". Ensure the required API key is set and the model name is correct. Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Recommended models - only the best/latest from each provider
 */
export const RECOMMENDED_MODELS = {
  openai: [
    "gpt-5",            // Latest - best for coding and agentic tasks
    "gpt-4o",           // Fallback option
  ],
  anthropic: [
    "claude-sonnet-4-20250514",    // Claude 4 Sonnet only
  ],
  google: [
    "gemini-2.5-flash",             // Gemini 2.5 Flash only
  ],
  xai: [
    "grok-4",                       // Latest Grok model
  ],
} as const;