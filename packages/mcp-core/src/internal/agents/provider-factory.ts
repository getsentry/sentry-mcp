import type { EmbeddedAgentProvider, AgentProviderType } from "./types";
import { getOpenAIModel, setOpenAIBaseUrl } from "./openai-provider";
import { getAnthropicModel, setAnthropicBaseUrl } from "./anthropic-provider";
import { ConfigurationError } from "../../errors";

// Module-level state for explicit provider selection
let configuredProvider: AgentProviderType | undefined;

/**
 * Configure the embedded agent provider explicitly.
 * Call this from CLI to override auto-detection.
 */
export function setAgentProvider(
  provider: AgentProviderType | undefined,
): void {
  configuredProvider = provider;
}

/**
 * Configure base URLs for providers (called from CLI).
 */
export function setProviderBaseUrls(config: {
  openaiBaseUrl?: string;
  anthropicBaseUrl?: string;
}): void {
  if (config.openaiBaseUrl) setOpenAIBaseUrl(config.openaiBaseUrl);
  if (config.anthropicBaseUrl) setAnthropicBaseUrl(config.anthropicBaseUrl);
}

/**
 * Check if the API key exists for a given provider type.
 */
function hasApiKeyForProvider(type: AgentProviderType): boolean {
  switch (type) {
    case "anthropic":
      return Boolean(process.env.ANTHROPIC_API_KEY);
    case "openai":
      return Boolean(process.env.OPENAI_API_KEY);
  }
}

/**
 * Get the expected API key name for a provider type.
 */
function getApiKeyName(type: AgentProviderType): string {
  switch (type) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
  }
}

/**
 * Build a provider instance for the given type.
 */
function buildProvider(type: AgentProviderType): EmbeddedAgentProvider {
  switch (type) {
    case "anthropic":
      return {
        type: "anthropic",
        getModel: getAnthropicModel,
        // Anthropic doesn't need the structuredOutputs workaround
        getProviderOptions: () => ({}),
        // Anthropic supports flexible temperature values, use default
        getTemperature: () => undefined,
      };
    case "openai":
      return {
        type: "openai",
        getModel: getOpenAIModel,
        // OpenAI requires structuredOutputs: false for optional fields
        // See: https://github.com/getsentry/sentry-mcp/issues/623
        getProviderOptions: () => ({
          openai: {
            structuredOutputs: false,
            strictJsonSchema: false,
          },
        }),
        // GPT-5 only supports temperature of 1
        getTemperature: () => 1,
      };
  }
}

/**
 * Get the current agent provider based on configuration.
 *
 * Resolution order:
 * 1. Explicit configuration via setAgentProvider()
 * 2. EMBEDDED_AGENT_PROVIDER environment variable
 * 3. Auto-detect: check ANTHROPIC_API_KEY, then OPENAI_API_KEY
 * 4. Throw ConfigurationError if no provider available
 */
export function getAgentProvider(): EmbeddedAgentProvider {
  // 1. Explicit configuration
  let providerType = configuredProvider;

  // 2. Environment variable
  if (!providerType) {
    const envProvider = process.env.EMBEDDED_AGENT_PROVIDER?.toLowerCase();
    if (envProvider === "openai" || envProvider === "anthropic") {
      providerType = envProvider;
    }
  }

  // 3. Validate API key for explicitly configured provider
  if (providerType && !hasApiKeyForProvider(providerType)) {
    throw new ConfigurationError(
      `Provider "${providerType}" is configured but ${getApiKeyName(providerType)} is not set. Please set the API key environment variable.`,
    );
  }

  // 4. Auto-detect based on available API keys
  if (!providerType) {
    if (process.env.ANTHROPIC_API_KEY) {
      providerType = "anthropic";
    } else if (process.env.OPENAI_API_KEY) {
      providerType = "openai";
    }
  }

  // 5. No provider available
  if (!providerType) {
    throw new ConfigurationError(
      "No embedded agent provider configured. " +
        "Set OPENAI_API_KEY or ANTHROPIC_API_KEY environment variable, " +
        "or use --agent-provider flag to specify a provider.",
    );
  }

  return buildProvider(providerType);
}

/**
 * Check if an embedded agent provider is available.
 * Returns true if getAgentProvider() would succeed.
 */
export function hasAgentProvider(): boolean {
  try {
    getAgentProvider();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the resolved provider type without throwing.
 * Returns undefined if no provider is available or API key is missing.
 */
export function getResolvedProviderType(): AgentProviderType | undefined {
  // Check explicit configuration (with API key validation)
  if (configuredProvider) {
    return hasApiKeyForProvider(configuredProvider)
      ? configuredProvider
      : undefined;
  }

  // Check environment variable (with API key validation)
  const envProvider = process.env.EMBEDDED_AGENT_PROVIDER?.toLowerCase();
  if (envProvider === "openai" || envProvider === "anthropic") {
    return hasApiKeyForProvider(envProvider) ? envProvider : undefined;
  }

  // Auto-detect based on available API keys
  if (process.env.ANTHROPIC_API_KEY) {
    return "anthropic";
  }
  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }

  return undefined;
}
