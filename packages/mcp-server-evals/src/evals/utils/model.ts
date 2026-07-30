import { getAgentProvider } from "@sentry/mcp-core/internal/agents/provider-factory";
import type { LanguageModel } from "ai";

type EvalModelConfig = {
  model: LanguageModel;
  providerOptions: ReturnType<
    ReturnType<typeof getAgentProvider>["getProviderOptions"]
  >;
};

/**
 * Resolve the eval model from the same embedded-agent provider configuration
 * used by MCP tools. This lets evals run against OpenRouter credentials when
 * OPENROUTER_API_KEY is configured.
 */
export function getEvalModelConfig(): EvalModelConfig {
  const provider = getAgentProvider();

  return {
    model: provider.getModel(),
    providerOptions: provider.getProviderOptions(),
  };
}
