import type { KVNamespace } from "@cloudflare/workers-types";

const DEFAULT_KEY_PREFIXES = ["grant:"];
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 1000;

export interface GrantWriteRetryOptions {
  /**
   * Maximum number of retry attempts after the initial failure.
   * Defaults to 2, allowing up to 3 total writes (initial + 2 retries).
   */
  maxRetries?: number;

  /**
   * Base delay in milliseconds before retrying. Each subsequent retry multiplies
   * the delay by the current attempt number (simple linear backoff).
   */
  baseDelayMs?: number;

  /**
   * Key prefixes that should participate in the retry logic.
   * Defaults to OAuth grant keys stored by the provider.
   */
  keyPrefixes?: string[];
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isRateLimitError = (error: unknown): error is Error => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message ?? "";
  return (
    message.includes("429") ||
    message.includes("Too Many Requests") ||
    message.includes("rate limit")
  );
};

const shouldRetryKey = (key: string, keyPrefixes: readonly string[]): boolean =>
  keyPrefixes.some((prefix) => key.startsWith(prefix));

/**
 * Wraps a KV namespace so that grant writes are retried when Cloudflare's per-key
 * rate limit (1 write/second) is exceeded. This avoids transient OAuth failures when
 * multiple refresh requests race to update the same grant record.
 */
export function withGrantWriteRetry(
  kv: KVNamespace,
  options: GrantWriteRetryOptions = {},
): KVNamespace {
  const config = {
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    baseDelayMs: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    keyPrefixes: options.keyPrefixes ?? DEFAULT_KEY_PREFIXES,
  };

  const putWithRetry: KVNamespace["put"] = async (key, value, putOptions) => {
    if (!shouldRetryKey(key, config.keyPrefixes)) {
      return kv.put(key, value, putOptions);
    }

    let attempt = 0;
    // Attempt the initial write + retries when rate limited
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await kv.put(key, value, putOptions);
      } catch (error) {
        if (!isRateLimitError(error) || attempt >= config.maxRetries) {
          throw error;
        }

        attempt += 1;
        const delay = config.baseDelayMs * attempt;
        console.warn(
          `[oauth] KV PUT hit per-key rate limit for grant data. Retrying in ${delay}ms.`,
        );
        await wait(delay);
      }
    }
  };

  return {
    get: kv.get.bind(kv),
    getWithMetadata: kv.getWithMetadata.bind(kv),
    put: putWithRetry,
    delete: kv.delete.bind(kv),
    list: kv.list.bind(kv),
  };
}
