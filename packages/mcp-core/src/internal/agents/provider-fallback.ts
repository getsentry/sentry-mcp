import { LLMProviderError } from "../../errors";
import { logWarn } from "../../telem/logging";

/**
 * Run an optional embedded-agent rewrite and fall back to the caller's direct
 * behavior when the upstream AI provider is unavailable.
 *
 * Provider failures are expected operational outages: log a warning and continue
 * with the caller's direct behavior. Unexpected application errors still bubble.
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

    logWarn(error, {
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
