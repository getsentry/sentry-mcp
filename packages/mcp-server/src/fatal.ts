/**
 * Re-entrancy-safe fatal error handling for the stdio server.
 *
 * When an MCP client dies without SIGINT/SIGTERM, all three stdio pipes can
 * break at once. Writing to a broken stderr from an uncaughtException handler
 * throws EPIPE *inside* the handler, which Node re-invokes forever — spinning
 * the process at 100%+ CPU. See getsentry/sentry-mcp#1274.
 */

export type FatalHandlerOptions = {
  timeoutMs: number;
  captureException: (error: unknown) => void;
  flush: (timeoutMs: number) => PromiseLike<unknown>;
  /** Defaults to a try/catch around console.error. */
  logError?: (message: string, error: unknown) => void;
  /** Defaults to process.exit. Injected for tests. */
  exit?: (code: number) => void;
  /** Defaults to setTimeout. Injected for tests. */
  setExitTimeout?: (fn: () => void, ms: number) => { unref?: () => void };
};

/**
 * Build a shared fatal handler for uncaughtException / unhandledRejection.
 *
 * Guarantees process.exit(1) even when stderr is broken or Sentry.flush hangs:
 * 1. try/catch around logging so a broken stderr cannot throw
 * 2. re-entrancy guard so a second fatal error exits immediately
 * 3. unref'd timeout so exit does not depend solely on flush resolving
 */
export function createFatalHandler(options: FatalHandlerOptions) {
  let handlingFatal = false;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const setExitTimeout =
    options.setExitTimeout ??
    ((fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms);
      timer.unref();
      return timer;
    });
  const logError =
    options.logError ??
    ((message: string, error: unknown) => {
      try {
        console.error(message, error);
      } catch {
        // stderr may already be gone (EPIPE) — never throw from the fatal path
      }
    });

  return function onFatal(error: unknown, label = "Fatal error:"): void {
    if (handlingFatal) {
      exit(1);
      return;
    }
    handlingFatal = true;

    try {
      logError(label, error);
    } catch {
      // broken stderr / hostile logger must not re-enter the fatal path
    }

    try {
      options.captureException(error);
    } catch {
      // Reporting must never block or re-enter the fatal path
    }

    setExitTimeout(() => exit(1), options.timeoutMs);

    void Promise.resolve()
      .then(() => options.flush(options.timeoutMs))
      .catch(() => {
        // ignore flush failures
      })
      .finally(() => {
        exit(1);
      });
  };
}

/**
 * Swallow EPIPE (and similar) on stdio streams so a dead client does not
 * surface stream errors as uncaughtException.
 */
export function ignoreBrokenStdioStreamErrors(
  streams: Array<NodeJS.WritableStream | NodeJS.ReadWriteStream> = [
    process.stdout,
    process.stderr,
  ],
): void {
  for (const stream of streams) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED") {
        return;
      }
      try {
        console.error("stdio stream error:", error);
      } catch {
        // ignore
      }
    });
  }
}
