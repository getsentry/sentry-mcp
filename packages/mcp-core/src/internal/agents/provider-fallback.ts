import { AgentExecutionError, LLMProviderError } from "../../errors";
import { logWarn } from "../../telem/logging";

/**
 * Run an optional embedded-agent rewrite and fall back to the caller's direct
 * behavior when the agent cannot complete the rewrite.
 *
 * - `LLMProviderError`: expected provider outage/quota/config. Log a warning
 *   and continue with the caller's direct behavior.
 * - `AgentExecutionError`: unexpected agent failure that already created a
 *   Sentry issue at the agent boundary. Fall back without filing another issue.
 * - Other errors still bubble (for example programming errors outside the agent).
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
    if (error instanceof LLMProviderError) {
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

    if (error instanceof AgentExecutionError) {
      // Issue already filed in callEmbeddedAgent. Keep the tool working with
      // the caller's original query/defaults instead of failing the MCP call.
      logWarn(error, {
        loggerScope: ["agents", "provider-fallback"],
        contexts: {
          aiProviderFallback: {
            operation,
            unexpectedAgentFailure: true,
            eventId: error.eventId ?? null,
          },
        },
      });
      onFallback?.();
      return fallback();
    }

    throw error;
  }
}
