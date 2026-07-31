/**
 * sentry local serve
 *
 * Start a local development server that captures Sentry SDK envelopes,
 * or attach to one already running on the same port.
 *
 * On startup the command probes `http://<host>:<port>/health`. If a server
 * is already listening, the command attaches as an SSE consumer and tails
 * events from it. Otherwise it starts its own Hono HTTP server.
 *
 * The command runs until interrupted (Ctrl-C / SIGTERM).
 */

import type { Server } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { serve } from "@hono/node-server";
import {
  createSpotlightBuffer,
  pushToSpotlightBuffer,
} from "@spotlightjs/spotlight/sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { SentryContext } from "../../context.js";
import { buildCommand, numberParser } from "../../lib/command.js";
import { ValidationError } from "../../lib/errors.js";
import { bold } from "../../lib/formatters/colors.js";
import type { FilterValue, FormatValue } from "../../lib/formatters/local.js";
import {
  FILTER_VALUES,
  FORMAT_VALUES,
  formatEnvelopeLines,
  formatEnvelopeLinesJson,
  formatItem,
  formatItemJson,
  isItemIncluded,
  SENTRY_CONTENT_TYPE,
} from "../../lib/formatters/local.js";
import { logger } from "../../lib/logger.js";

/** Default port for the local dev server. */
export const DEFAULT_PORT = 8969;

/** Buffer size: how many recent envelopes to retain for late subscribers. */
const BUFFER_SIZE = 500;

/** Trailing carriage return — stripped from SSE lines. */
const CR_RE = /\r$/;

/** Maximum ingest body size (10 MB). Rejects oversized payloads early. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Parse and validate a `--format` value.
 * Accepts: human, json.
 */
function parseFormat(value: string): FormatValue {
  const lower = value.toLowerCase();
  if (!FORMAT_VALUES.includes(lower as FormatValue)) {
    throw new ValidationError(
      `Invalid format "${value}". Valid values: ${FORMAT_VALUES.join(", ")}`,
      "format"
    );
  }
  return lower as FormatValue;
}

/**
 * Parse and validate a `--filter` value.
 * Accepts the canonical names: error, transaction, logger.
 */
function parseFilter(value: string): FilterValue {
  const lower = value.toLowerCase();
  if (!FILTER_VALUES.includes(lower as FilterValue)) {
    throw new ValidationError(
      `Invalid filter "${value}". Valid values: ${FILTER_VALUES.join(", ")}`,
      "filter"
    );
  }
  return lower as FilterValue;
}

type LocalFlags = {
  readonly port: number;
  readonly host: string;
  readonly quiet: boolean;
  readonly filter: FilterValue[];
  readonly format: FormatValue;
  readonly attributes: boolean;
};

/**
 * Validate a port number from `--port`.
 *
 * Hard-fails on out-of-range values so users get a clean error rather than
 * a `listen EADDRNOTAVAIL` from the kernel.
 */
export function parsePort(value: string): number {
  const port = numberParser(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new ValidationError(
      `Invalid port: ${value}. Must be an integer between 0 and 65535.`,
      "port"
    );
  }
  return port;
}

/** Match localhost origins on any port (http or https), including IPv6. */
const LOCALHOST_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Build the Hono application.
 *
 * CORS is restricted to localhost origins — dev stacks send from arbitrary
 * `localhost:*` ports (Vite, Next, Astro, etc.) but we must not allow
 * arbitrary remote origins to read the SSE envelope stream.
 */

/** Build a subscriber callback that serializes envelopes to an SSE stream. */
function buildSSEHandler(stream: {
  writeSSE: (event: {
    id?: string;
    event?: string;
    data: string;
  }) => Promise<void>;
}) {
  return (container: {
    getParsedEnvelope: () => {
      envelope: [Record<string, unknown>, unknown[]];
    } | null;
    getContentType: () => string;
  }) => {
    try {
      const parsed = container.getParsedEnvelope();
      if (!parsed) {
        return;
      }
      const header = parsed.envelope[0];
      const envelopeId = header.__spotlight_envelope_id;
      stream
        .writeSSE({
          id: envelopeId ? String(envelopeId) : undefined,
          event: container.getContentType(),
          data: JSON.stringify(parsed.envelope),
        })
        .catch((err: unknown) => {
          logger.debug(
            `SSE write failed (client likely disconnected): ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        });
    } catch (err) {
      logger.debug(
        `SSE serialize failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };
}

export function buildApp(
  spotlightBuffer: ReturnType<typeof createSpotlightBuffer>
): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => (LOCALHOST_ORIGIN_RE.test(origin) ? origin : null),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Content-Encoding", "User-Agent"],
    })
  );

  app.get("/health", (c) => c.text("OK"));

  const ingest = async (c: {
    req: {
      arrayBuffer: () => Promise<ArrayBuffer>;
      header: (name: string) => string | undefined;
      query: (name: string) => string | undefined;
    };
    body: (data: null, status: number) => Response;
  }) => {
    const contentLength = Number(c.req.header("content-length") ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      return c.body(null, 413);
    }
    const arrayBuf = await c.req.arrayBuffer();
    if (arrayBuf.byteLength > MAX_BODY_BYTES) {
      return c.body(null, 413);
    }
    const body = Buffer.from(arrayBuf);
    // Browser SDKs using sendBeacon() set Content-Type to text/plain to
    // avoid CORS preflight. Detect this via the sentry_client query param
    // and override to the canonical Sentry envelope content type.
    let contentType = c.req.header("content-type") ?? "";
    if (
      c.req.query("sentry_client")?.startsWith("sentry.javascript.browser") &&
      c.req.header("origin")
    ) {
      contentType = SENTRY_CONTENT_TYPE;
    }
    const rawEncoding = c.req.header("content-encoding");
    const contentEncoding = (
      rawEncoding === "gzip" ||
      rawEncoding === "deflate" ||
      rawEncoding === "br"
        ? rawEncoding
        : undefined
    ) as "gzip" | "deflate" | "br" | undefined;
    const userAgent = c.req.header("user-agent");

    pushToSpotlightBuffer({
      spotlightBuffer,
      body,
      encoding: contentEncoding,
      contentType,
      userAgent,
    });

    return c.body(null, 204);
  };

  app.post("/stream", ingest);
  app.post("/api/:projectId/envelope/", ingest);
  app.post("/api/:projectId/envelope", ingest);

  /**
   * SSE stream — overlay / UI clients connect here to receive a
   * live feed of envelopes. The SSE event format:
   *   - `event` is the content type (e.g., "application/x-sentry-envelope")
   *   - `id` is the envelope UUID (enables reconnection)
   *   - `data` is the parsed envelope JSON ([header, items])
   */
  app.get("/stream", (c) =>
    streamSSE(c, async (stream) => {
      const lastEventId = c.req.header("Last-Event-ID");
      const onEnvelope = buildSSEHandler(stream);
      const readerId = spotlightBuffer.subscribe(onEnvelope, lastEventId);

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          spotlightBuffer.unsubscribe(readerId);
          resolve();
        });
      });
    })
  );

  return app;
}

/**
 * Install signal handlers that stop the HTTP server on Ctrl-C / SIGTERM.
 *
 * Returns a Promise that resolves when shutdown is complete. The command
 * awaits this so the generator stays alive until the user interrupts.
 */
function waitForShutdown(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    let shuttingDown = false;
    const onSigint = () => shutdown("SIGINT");
    const onSigterm = () => shutdown("SIGTERM");

    function shutdown(signal: NodeJS.Signals) {
      if (shuttingDown) {
        process.exit(0);
      }
      shuttingDown = true;
      logger.log(`Received ${signal}, shutting down...`);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      server.close(() => resolve());
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
    }

    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
  });
}

/** Maximum retries on EADDRINUSE before giving up. */
const MAX_PORT_RETRIES = 3;

/** Delay between EADDRINUSE retries in milliseconds. */
const PORT_RETRY_DELAY_MS = 5000;

/**
 * Try to start the HTTP server, retrying with backoff on EADDRINUSE.
 *
 * Retries up to {@link MAX_PORT_RETRIES} times with a {@link PORT_RETRY_DELAY_MS}
 * delay between attempts.
 */
export function tryListen(
  app: Hono,
  port: number,
  hostname: string
): Promise<{ server: Server; port: number }> {
  let attempts = 0;

  const attempt = (): Promise<{ server: Server; port: number }> =>
    new Promise((resolve, reject) => {
      const server = serve({
        fetch: app.fetch,
        port,
        hostname,
      }) as unknown as Server;

      server.once("listening", () => {
        const addr = server.address();
        const boundPort = typeof addr === "object" && addr ? addr.port : port;
        resolve({ server, port: boundPort });
      });
      server.once("error", async (err: NodeJS.ErrnoException) => {
        server.close();
        if (err.code === "EADDRINUSE") {
          attempts += 1;
          if (attempts > MAX_PORT_RETRIES) {
            reject(
              new ValidationError(
                `Port ${port} is in use after ${MAX_PORT_RETRIES} retries`,
                "port"
              )
            );
            return;
          }
          logger.warn(
            `Port ${port} is in use, retrying in ${PORT_RETRY_DELAY_MS / 1000}s (attempt ${attempts}/${MAX_PORT_RETRIES})...`
          );
          await sleep(PORT_RETRY_DELAY_MS);
          resolve(attempt());
          return;
        }
        reject(err);
      });
    });

  return attempt();
}

/**
 * Check whether a server is already running on the given URL.
 * Returns `true` if the health endpoint responds successfully.
 */
export async function isServerRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch (err) {
    logger.debug(
      `No existing server at ${url}`,
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

/** Mutable state for the SSE line parser. */
type SSEParserState = {
  eventType: string;
  dataLines: string[];
  id: string;
};

/** Process a single SSE line, dispatching complete events via callback. */
export function feedSSELine(
  line: string,
  state: SSEParserState,
  onEvent: (type: string, data: string, id: string) => void
): void {
  if (line.startsWith("event:")) {
    const value = line.slice(6);
    state.eventType = value.startsWith(" ") ? value.slice(1) : value;
  } else if (line.startsWith("data:")) {
    const value = line.slice(5);
    state.dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
  } else if (line.startsWith("id:")) {
    const value = line.slice(3);
    state.id = value.startsWith(" ") ? value.slice(1) : value;
  } else if (line === "" && state.dataLines.length > 0) {
    onEvent(state.eventType, state.dataLines.join("\n"), state.id);
    state.eventType = "";
    state.dataLines = [];
    state.id = "";
  }
}

/** Maximum SSE reconnection attempts before giving up. */
const SSE_MAX_RECONNECTS = 10;

/** Initial delay between SSE reconnection attempts (doubles each retry). */
const SSE_INITIAL_RETRY_MS = 1000;

/** Maximum delay between SSE reconnection attempts. */
const SSE_MAX_RETRY_MS = 30_000;

/** Options for consuming an SSE stream. */
type ConsumeSSEOptions = {
  url: string;
  activeFilters: ReadonlySet<FilterValue>;
  signal: AbortSignal;
  quiet?: boolean;
  useJson?: boolean;
  showAttributes?: boolean;
};

/** Check whether an error is an abort signal. */
function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

/** Sleep with abort support, suppressing abort errors. */
async function sleepUnlessAborted(
  ms: number,
  signal: AbortSignal
): Promise<void> {
  try {
    await sleep(ms, undefined, { signal });
  } catch (err) {
    if (!isAbortError(err)) {
      throw err;
    }
  }
}

/**
 * Consume SSE events from an upstream server and print them.
 *
 * Reconnects automatically on connection loss with exponential backoff,
 * using `Last-Event-ID` to resume from where the stream left off.
 */
async function consumeSSE(opts: ConsumeSSEOptions): Promise<void> {
  const {
    url,
    activeFilters,
    signal,
    quiet = false,
    useJson = false,
    showAttributes = false,
  } = opts;
  let lastEventId: string | undefined;
  let retries = 0;
  let retryDelay = SSE_INITIAL_RETRY_MS;
  let hasConnectedBefore = false;

  while (!signal.aborted) {
    const result = await attemptSSEConnection({
      url,
      activeFilters,
      signal,
      quiet,
      useJson,
      showAttributes,
      lastEventId,
      onId: (id) => {
        lastEventId = id;
      },
    });

    if (signal.aborted) {
      return;
    }
    // On the first attempt, both "no-connection" (HTTP error/no body) and
    // "error" (network failure) are fatal — the server doesn't exist.
    // After a previous successful connection, retry on any failure since
    // the server may be restarting.
    if (!hasConnectedBefore && result !== "connected-then-lost") {
      return;
    }
    // Reset backoff after a successful connection that later dropped,
    // so transient disconnects don't permanently exhaust the retry budget.
    if (result === "connected-then-lost") {
      hasConnectedBefore = true;
      retries = 0;
      retryDelay = SSE_INITIAL_RETRY_MS;
    }
    retries += 1;
    if (retries > SSE_MAX_RECONNECTS) {
      logger.warn(
        `SSE connection lost after ${SSE_MAX_RECONNECTS} reconnection attempts`
      );
      return;
    }
    logger.info(
      `SSE connection lost, reconnecting in ${retryDelay / 1000}s...`
    );
    await sleepUnlessAborted(retryDelay, signal);
    retryDelay = Math.min(retryDelay * 2, SSE_MAX_RETRY_MS);
  }
}

/**
 * Attempt a single SSE connection. Returns:
 * - `"no-connection"` if the server couldn't be reached or aborted
 * - `"connected-then-lost"` if a connection was established (got HTTP 200)
 *   but the stream ended or errored — eligible for reconnection
 */
async function attemptSSEConnection(
  opts: ConsumeSSEOnceOptions
): Promise<"no-connection" | "connected-then-lost"> {
  let wasConnected = false;
  const augmented = {
    ...opts,
    onConnected: () => {
      wasConnected = true;
    },
  };
  try {
    const completed = await consumeSSEOnce(augmented);
    return completed ? "connected-then-lost" : "no-connection";
  } catch (err: unknown) {
    if (isAbortError(err) || opts.signal.aborted) {
      return "no-connection";
    }
    logger.debug(
      `SSE error: ${err instanceof Error ? err.message : String(err)}`
    );
    // If we got a 200 response before the error, the connection existed
    // and is worth retrying. Otherwise, the server is unreachable.
    return wasConnected ? "connected-then-lost" : "no-connection";
  }
}

/** Options for a single SSE connection attempt. */
type ConsumeSSEOnceOptions = {
  url: string;
  activeFilters: ReadonlySet<FilterValue>;
  signal: AbortSignal;
  quiet: boolean;
  useJson: boolean;
  showAttributes: boolean;
  lastEventId: string | undefined;
  onId: (id: string) => void;
  /** Called when the HTTP response is received (200 OK with body). */
  onConnected?: () => void;
};

/**
 * Single SSE connection attempt. Returns `true` if a connection was
 * established (received a 200 response), `false` if it never connected.
 * The caller uses this to decide whether to retry on failure.
 */
async function consumeSSEOnce(opts: ConsumeSSEOnceOptions): Promise<boolean> {
  const {
    url,
    activeFilters,
    signal,
    quiet,
    useJson,
    showAttributes,
    lastEventId,
    onId,
    onConnected,
  } = opts;
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (lastEventId) {
    headers["Last-Event-ID"] = lastEventId;
  }
  const res = await fetch(`${url}/stream`, { headers, signal });
  if (!res.ok) {
    logger.warn(`SSE stream returned HTTP ${res.status}`);
    return false;
  }
  if (!res.body) {
    return false;
  }
  // Signal that we have a live connection — the caller uses this to
  // decide whether mid-stream errors are worth retrying.
  onConnected?.();

  // In quiet mode we still consume the stream to detect disconnection,
  // but skip parsing/formatting entirely.
  if (quiet) {
    for await (const _chunk of res.body) {
      // drain
    }
    return true;
  }

  const decoder = new TextDecoder();
  const state: SSEParserState = { eventType: "", dataLines: [], id: "" };
  const onEvent = (type: string, data: string, id: string) => {
    if (id) {
      onId(id);
    }
    if (type === SENTRY_CONTENT_TYPE) {
      processSSEEvent(data, activeFilters, useJson, showAttributes);
    }
  };

  let partial = "";
  for await (const chunk of res.body) {
    const text =
      partial + decoder.decode(chunk as Uint8Array, { stream: true });
    const lines = text.split("\n");
    partial = lines.pop() ?? "";
    for (const rawLine of lines) {
      feedSSELine(rawLine.replace(CR_RE, ""), state, onEvent);
    }
  }
  if (partial) {
    feedSSELine(partial.replace(CR_RE, ""), state, onEvent);
  }
  return true;
}

/** Parse and format a single SSE data payload from upstream. */
function processSSEEvent(
  data: string,
  activeFilters: ReadonlySet<FilterValue>,
  useJson = false,
  showAttributes = false
): void {
  try {
    const envelope = JSON.parse(data) as [
      Record<string, unknown>,
      [{ type?: string }, unknown][],
    ];
    const [header, items] = envelope;
    for (const [itemHeader, itemPayload] of items) {
      const payload = itemPayload as Record<string, unknown>;
      if (!isItemIncluded(itemHeader.type, activeFilters, payload)) {
        continue;
      }
      const lines = useJson
        ? formatItemJson(itemHeader.type, payload, header, showAttributes)
        : formatItem(
            itemHeader.type,
            payload,
            header,
            itemHeader.type ?? "envelope",
            showAttributes
          );
      for (const line of lines) {
        logger.log(line);
      }
    }
  } catch (err) {
    logger.debug(
      `Failed to parse SSE event: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export const serverCommand = buildCommand({
  docs: {
    brief: "Start the local dev server and tail events",
    fullDescription:
      "Start a local development server that captures envelopes from\n" +
      "Sentry SDKs in your dev stack and tails them to the terminal.\n\n" +
      "If a server is already listening on the port, the command connects\n" +
      "as an SSE consumer and tails events from it. Otherwise it starts\n" +
      "its own server.\n\n" +
      "Press Ctrl-C to stop.",
  },
  parameters: {
    flags: {
      port: {
        kind: "parsed",
        parse: parsePort,
        brief: `Port to listen on (default ${DEFAULT_PORT})`,
        default: String(DEFAULT_PORT),
      },
      host: {
        kind: "parsed",
        parse: String,
        brief: "Hostname to bind to (default localhost)",
        default: "localhost",
      },
      quiet: {
        kind: "boolean",
        brief: "Suppress per-envelope tail output",
        default: false,
      },
      filter: {
        kind: "parsed",
        parse: parseFilter,
        brief:
          "Only show items of this type (repeatable: error, transaction, log, ai)",
        variadic: true,
        optional: true,
      },
      format: {
        kind: "parsed",
        parse: parseFormat,
        brief: "Output format: human (default) or json (NDJSON)",
        default: "human",
      },
      attributes: {
        kind: "boolean",
        brief:
          "Show a grouped attribute table (user vs SDK) under each transaction",
        default: false,
      },
    },
    aliases: {
      p: "port",
      H: "host",
      q: "quiet",
      f: "filter",
      F: "format",
      a: "attributes",
    },
  },
  auth: false,
  async *func(this: SentryContext, flags: LocalFlags) {
    const activeFilters = new Set(flags.filter);
    const url = `http://${flags.host}:${flags.port}`;

    if (await isServerRunning(url)) {
      logger.info(`Connected to existing server at ${bold(url)}`);
      if (activeFilters.size > 0) {
        logger.info(`Filtering: ${[...activeFilters].join(", ")}`);
      }
      logger.info("Press Ctrl-C to stop.");

      const ac = new AbortController();
      const stop = () => ac.abort();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);

      try {
        await consumeSSE({
          url,
          activeFilters,
          signal: ac.signal,
          quiet: flags.quiet,
          useJson: flags.format === "json",
          showAttributes: flags.attributes,
        });
      } catch (err: unknown) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          throw err;
        }
      } finally {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      }
      logger.log("Disconnected.");
      return;
    }

    const buffer = createSpotlightBuffer(BUFFER_SIZE);
    const useJson = flags.format === "json";

    if (!flags.quiet) {
      const formatFn = useJson ? formatEnvelopeLinesJson : formatEnvelopeLines;
      buffer.subscribe((container) => {
        try {
          for (const line of formatFn(
            container,
            activeFilters,
            flags.attributes
          )) {
            logger.log(line);
          }
        } catch (err) {
          logger.debug(
            `Failed to format envelope: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      });
    }

    const app = buildApp(buffer);

    const { server, port: boundPort } = await tryListen(
      app,
      flags.port,
      flags.host
    );

    const listenUrl = `http://${flags.host}:${boundPort}`;
    logger.info("Sentry Local Dev Server");
    logger.info(`  Ingest: ${bold(`${listenUrl}/stream`)}`);
    logger.info(`  Events: ${bold(`${listenUrl}/stream`)} (SSE)`);
    logger.info("");
    logger.info(
      `  Set ${bold("SENTRY_SPOTLIGHT")}=${listenUrl}/stream in your app`
    );
    logger.info(
      `  Or run: ${bold(`sentry local run -p ${boundPort} -- <your-command>`)}`
    );
    if (activeFilters.size > 0) {
      logger.info(`  Filtering: ${[...activeFilters].join(", ")}`);
    }
    if (useJson) {
      logger.info("  Output: JSON (NDJSON)");
    }
    logger.info("");
    logger.info("Press Ctrl-C to stop.");

    await waitForShutdown(server);
    logger.log("Server stopped.");
  },
});
