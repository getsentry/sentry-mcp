import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { ConfigurationError } from "../../errors";
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

function hasAzureDeploymentPath(baseUrl: string): boolean {
  const pathname = new URL(baseUrl).pathname.replace(/\/+$/, "");
  return /\/openai\/deployments\/[^/]+$/i.test(pathname);
}

function isResponsesOnlyOpenAIModel(modelId: string): boolean {
  return (
    modelId.startsWith("codex-") ||
    modelId.startsWith("computer-use-preview") ||
    /^gpt-[\d.]+-codex(?:-|$)/.test(modelId)
  );
}

function isCanonicalOpenAIModelId(modelId: string): boolean {
  return (
    modelId === "chatgpt-4o-latest" ||
    modelId.startsWith("gpt-") ||
    modelId.startsWith("o1") ||
    modelId.startsWith("o3") ||
    modelId.startsWith("o4") ||
    modelId.startsWith("codex-") ||
    modelId.startsWith("computer-use-preview")
  );
}

function shouldUseChatCompletionsApi(modelId: string): boolean {
  if (!configuredBaseUrl) {
    return false;
  }

  // Azure-style deployment endpoints and compatible proxies typically expose
  // chat completions at the deployment URL. Preserve the 0.29.x behavior there
  // without forcing all custom base URLs or responses-only models off the
  // Responses API. Opaque deployment aliases are rejected because we cannot
  // safely infer whether they target a responses-only backend model.
  if (
    hasAzureDeploymentPath(configuredBaseUrl) &&
    !isCanonicalOpenAIModelId(modelId)
  ) {
    throw new ConfigurationError(
      `Deployment-style OpenAI base URLs require a canonical OPENAI_MODEL value. Use the formal OpenAI model name instead of the deployment alias "${modelId}" so the correct API can be selected.`,
    );
  }

  return (
    hasAzureDeploymentPath(configuredBaseUrl) &&
    !isResponsesOnlyOpenAIModel(modelId)
  );
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
  const modelId = model ?? (process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL);

  const factory = createOpenAI({
    ...(configuredBaseUrl && { baseURL: configuredBaseUrl }),
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  if (shouldUseChatCompletionsApi(modelId)) {
    return factory.chat(modelId);
  }

  return factory(modelId);
}
