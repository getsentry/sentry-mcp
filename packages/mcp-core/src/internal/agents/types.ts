import type { LanguageModel, JSONValue } from "ai";

/**
 * Provider options type matching AI SDK's ProviderOptions (LanguageModelV1ProviderMetadata)
 */
export type ProviderOptions = Record<string, Record<string, JSONValue>>;

/**
 * Supported embedded agent provider types.
 */
export type AgentProviderType = "openai" | "anthropic";

/**
 * Interface for embedded agent providers.
 * Provides a unified way to get language models and provider-specific options.
 */
export interface EmbeddedAgentProvider {
  /** The provider type identifier */
  readonly type: AgentProviderType;

  /** Get a language model instance, optionally with a model override */
  getModel(modelOverride?: string): LanguageModel;

  /** Get provider-specific options for generateText calls */
  getProviderOptions(): ProviderOptions;

  /** Get the temperature value for this provider, or undefined to use default */
  getTemperature(): number | undefined;
}
