import { LLMProviderError } from "../../errors";
import { logError } from "../../telem/logging";

/**
 * Run an optional embedded-agent rewrite and fall back to the caller's direct
 * behavior when the upstream AI provider is unavailable.
 *
 * Provider failures are operationally visible in logs, but do not fail the
 * parent MCP tool. Unexpected application errors still bubble normally.
 */
export async function withProviderFallback<T>({
  operation,
  fallback,
  onFallback,
  run,
}: {
  operation: string;
  fallback: () => T;
  onFallback?: () => void;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof LLMProviderError)) {
      throw error;
    }

    logError(error, {
      loggerScope: ["agents", "provider-fallback"],
      contexts: {
        aiProviderFallback: {
          operation,
        },
      },
    });
    onFallback?.();

    return fallback();
  }
}
