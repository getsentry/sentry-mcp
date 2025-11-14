import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import { USER_AGENT } from "../../version";

// Default configuration constants
const DEFAULT_OPENAI_MODEL = "gpt-5";
const VALID_REASONING_EFFORTS = ["low", "medium", "high"] as const;
const DEFAULT_REASONING_EFFORT: (typeof VALID_REASONING_EFFORTS)[number] =
  "low";

type ReasoningEffort = (typeof VALID_REASONING_EFFORTS)[number];

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
 * Check if a model supports reasoning effort parameter (o1 series only)
 */
function supportsReasoningEffort(modelName: string): boolean {
  return modelName.startsWith("o1-") || modelName.startsWith("o3-");
}

/**
 * Retrieve an OpenAI language model configured from environment variables and explicit config.
 *
 * Configuration:
 * - OPENAI_MODEL: Model to use (default: "gpt-5") - env var OK
 * - OPENAI_REASONING_EFFORT: Reasoning effort for o1 models: "low", "medium", "high", or "" to disable (default: "low" for o1 models) - env var OK
 * - Base URL: Must be set via setOpenAIBaseUrl() - NOT from env vars (security risk)
 */
export function getOpenAIModel(model?: string): LanguageModelV1 {
  const defaultModel = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const selectedModel = model ?? defaultModel;

  // Handle reasoning effort: empty string explicitly disables it, undefined uses default
  const envReasoningEffort = process.env.OPENAI_REASONING_EFFORT;
  let reasoningEffort: ReasoningEffort | undefined;

  // Validate reasoning effort if it's set (regardless of model)
  if (envReasoningEffort === "") {
    // Empty string explicitly disables reasoning effort
    reasoningEffort = undefined;
  } else if (envReasoningEffort === undefined) {
    // Not set - use default only for o1 models
    if (supportsReasoningEffort(selectedModel)) {
      reasoningEffort = DEFAULT_REASONING_EFFORT;
    }
  } else if (
    VALID_REASONING_EFFORTS.includes(envReasoningEffort as ReasoningEffort)
  ) {
    // Valid value - only use it for o1 models
    if (supportsReasoningEffort(selectedModel)) {
      reasoningEffort = envReasoningEffort as ReasoningEffort;
    }
  } else {
    // Invalid value - always throw error to help users catch configuration mistakes
    const validValues = VALID_REASONING_EFFORTS.map((v) => `"${v}"`).join(", ");
    throw new Error(
      `Invalid OPENAI_REASONING_EFFORT value: "${envReasoningEffort}". Must be one of: ${validValues}, or "" (empty string to disable). Default is "${DEFAULT_REASONING_EFFORT}".`,
    );
  }

  const factory = createOpenAI({
    ...(configuredBaseUrl && { baseURL: configuredBaseUrl }),
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  return factory(selectedModel, {
    ...(reasoningEffort && { reasoningEffort }),
  });
}
