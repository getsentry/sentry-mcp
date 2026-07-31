/**
 * sentry local run
 *
 * Run a command with the local dev server enabled. Injects
 * `SENTRY_SPOTLIGHT` (read automatically by server-side SDKs) plus the
 * framework-prefixed client variants (`NEXT_PUBLIC_SENTRY_SPOTLIGHT`,
 * `VITE_SENTRY_SPOTLIGHT`, etc.) so the spotlight URL also reaches
 * browser bundles regardless of bundler.
 *
 * If no server is already running on the target port, one is started
 * automatically in the background and shut down when the child exits.
 */

import { type ChildProcess, spawn } from "node:child_process";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { createSpotlightBuffer } from "@spotlightjs/spotlight/sdk";
import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import { detectDevCommand } from "../../lib/dev-script.js";
import { CliError, EXIT, ValidationError } from "../../lib/errors.js";
import { bold } from "../../lib/formatters/colors.js";
import { formatEnvelopeLines } from "../../lib/formatters/local.js";
import { logger } from "../../lib/logger.js";
import {
  buildApp,
  DEFAULT_PORT,
  isServerRunning,
  parsePort,
  tryListen,
} from "./server.js";

type RunFlags = {
  readonly port: number;
  readonly host: string;
  readonly verify: boolean;
  readonly timeout: number;
};

/** Buffer size for the auto-started background server. */
export const BUFFER_SIZE = 500;

/**
 * Client-side env var prefixes that frameworks inline into browser bundles
 * at build time. We inject `<PREFIX>SENTRY_SPOTLIGHT` for every variant so the
 * spotlight URL reaches whichever bundler the user's app uses.
 *
 * Mirrors the prefixes the Sentry browser SDK is intended to read for
 * Spotlight configuration (see getsentry/sentry-javascript#18198). Note this
 * set differs from the DSN-detection prefixes in `src/lib/dsn/env.ts`: it adds
 * `PUBLIC_` (SvelteKit/Astro/Qwik), `VUE_APP_` (Vue CLI), and `GATSBY_`
 * (Gatsby), and omits `EXPO_PUBLIC_` (React Native has no browser bundle).
 */
export const CLIENT_SPOTLIGHT_PREFIXES = [
  "PUBLIC_", // SvelteKit, Astro, Qwik
  "NEXT_PUBLIC_", // Next.js
  "VITE_", // Vite
  "NUXT_PUBLIC_", // Nuxt
  "REACT_APP_", // Create React App
  "VUE_APP_", // Vue CLI
  "GATSBY_", // Gatsby
] as const;

/**
 * Shut down a background server, closing all connections so keep-alive
 * sockets (e.g. SSE subscribers) don't block exit.
 */
export function shutdownServer(server: Server): Promise<void> {
  return new Promise<void>((done) => {
    server.close(() => done());
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
  });
}

/** Parse a timeout value, ensuring it's a non-negative integer. */
function parseTimeout(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(
      `Invalid timeout: ${value}. Must be a non-negative number.`,
      "timeout"
    );
  }
  return n;
}

/**
 * Whether the detected command originated from a package.json script.
 * Used to decide if `./node_modules/.bin` should be prepended to PATH.
 */
function isPackageJsonSource(source: string): boolean {
  return source.startsWith("package.json");
}

/** State for a background server started by `local run`. */
type BackgroundServer = {
  url: string;
  cleanup: () => Promise<void>;
};

/**
 * Start a background dev server and subscribe to its buffer so incoming
 * envelopes are printed inline, matching the behavior of `sentry local serve`.
 */
async function startBackgroundServer(
  port: number,
  host: string
): Promise<BackgroundServer> {
  const buffer = createSpotlightBuffer(BUFFER_SIZE);
  const app = buildApp(buffer);
  const { server, port: boundPort } = await tryListen(app, port, host);
  const url = `http://${host}:${boundPort}`;

  const noFilters = new Set<never>();
  const subscriptionId = buffer.subscribe((container) => {
    try {
      for (const line of formatEnvelopeLines(container, noFilters)) {
        logger.log(line);
      }
    } catch (err) {
      logger.debug(
        `Failed to format envelope: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });

  return {
    url,
    cleanup: async () => {
      buffer.unsubscribe(subscriptionId);
      logger.info("Stopping background server...");
      await shutdownServer(server);
    },
  };
}

/** Augment PATH with `./node_modules/.bin` for Node project scripts. */
function augmentPathForNode(
  env: Record<string, string | undefined>,
  cwd: string
): Record<string, string | undefined> {
  const binDir = resolve(cwd, "node_modules", ".bin");
  const sep = process.platform === "win32" ? ";" : ":";
  return {
    ...env,
    PATH: env.PATH ? `${binDir}${sep}${env.PATH}` : binDir,
  };
}

const AUTO_DETECT_ERROR_MESSAGE = [
  "No command provided and could not auto-detect a dev script.",
  "Usage: sentry local run -- <command>",
  "",
  "Supported auto-detection:",
  "  - package.json (scripts: dev, develop, serve, start)",
  "  - manage.py (Django)",
  "  - app.py / main.py (Python)",
  "  - go.mod (Go)",
  "  - docker-compose.yml / compose.yml (Docker Compose)",
].join("\n");

/** Build the env vars for the child process. */
function buildChildEnv(
  spotlightUrl: string,
  commandSource: string,
  cwd: string
): Record<string, string | undefined> {
  const clientSpotlightVars = Object.fromEntries(
    CLIENT_SPOTLIGHT_PREFIXES.map((prefix) => [
      `${prefix}SENTRY_SPOTLIGHT`,
      spotlightUrl,
    ])
  );
  let env: Record<string, string | undefined> = {
    ...process.env,
    ...clientSpotlightVars,
    SENTRY_SPOTLIGHT: spotlightUrl,
    SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE ?? "1",
    SENTRY_RELEASE: process.env.SENTRY_RELEASE ?? "sentry-cli-local",
  };
  if (isPackageJsonSource(commandSource)) {
    env = augmentPathForNode(env, cwd);
  }
  return env;
}

/** Resolve args and source — auto-detect from filesystem when no args provided. */
async function resolveArgs(
  stripped: string[],
  cwd: string
): Promise<{ args: string[]; commandSource: string }> {
  if (stripped.length > 0) {
    return { args: stripped, commandSource: "" };
  }
  const detected = await detectDevCommand(cwd);
  if (!detected) {
    throw new ValidationError(AUTO_DETECT_ERROR_MESSAGE, "command");
  }
  logger.info(`Detected ${detected.source}: ${detected.args.join(" ")}`);
  return { args: detected.args, commandSource: detected.source };
}

export const runCommand = buildCommand({
  docs: {
    brief: "Run a command with the local dev server enabled",
    fullDescription:
      "Run a command with the SENTRY_SPOTLIGHT environment variable\n" +
      "injected so the Sentry SDK automatically sends envelopes to the\n" +
      "local server.\n\n" +
      "If no server is already listening on the port, one is started\n" +
      "automatically and shut down when the child process exits.\n\n" +
      "The child process inherits all current env vars plus\n" +
      "SENTRY_SPOTLIGHT (server-side SDKs read this automatically), the\n" +
      "framework-prefixed client variants (NEXT_PUBLIC_, VITE_, etc.), and\n" +
      "SENTRY_TRACES_SAMPLE_RATE=1.\n\n" +
      "Example:\n" +
      "  sentry local run -- npm run dev\n" +
      "  sentry local run -- python manage.py runserver",
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        brief: "Command to run",
        parse: String,
        placeholder: "command",
      },
    },
    flags: {
      port: {
        kind: "parsed",
        parse: parsePort,
        brief: `Port for the local server (default ${DEFAULT_PORT})`,
        default: String(DEFAULT_PORT),
      },
      host: {
        kind: "parsed",
        parse: String,
        brief: "Hostname for the local server (default localhost)",
        default: "localhost",
      },
      verify: {
        kind: "boolean",
        brief: "Verify SDK sends events, then exit",
        default: false,
      },
      timeout: {
        kind: "parsed",
        parse: parseTimeout,
        brief:
          "Kill the child after N seconds (0 = no timeout; defaults to 30 s in --verify mode)",
        default: "0",
      },
    },
    aliases: {
      p: "port",
      V: "verify",
      t: "timeout",
    },
  },
  auth: false,
  async *func(this: SentryContext, flags: RunFlags, ...rawArgs: string[]) {
    const stripped = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
    const { args, commandSource } = await resolveArgs(stripped, this.cwd);

    if (flags.verify) {
      yield* runWithVerify(args, flags, this.cwd, commandSource);
      return;
    }

    let url = `http://${flags.host}:${flags.port}`;
    let bg: BackgroundServer | undefined;

    const alreadyRunning = await isServerRunning(url);
    if (!alreadyRunning) {
      logger.info("No server detected, starting one in the background...");
      bg = await startBackgroundServer(flags.port, flags.host);
      url = bg.url;
      logger.info(`Background server listening on ${bold(url)}`);
    }

    const spotlightUrl = `${url}/stream`;
    logger.info(`Starting: ${bold(args.join(" "))}`);
    logger.info(`SENTRY_SPOTLIGHT=${spotlightUrl}`);

    const childEnv = buildChildEnv(spotlightUrl, commandSource, this.cwd);

    let child: ChildProcess;
    try {
      const [cmd = "", ...cmdArgs] = args;
      child = spawn(cmd, cmdArgs, {
        cwd: this.cwd,
        env: childEnv,
        stdio: "inherit",
      });
    } catch (err) {
      if (bg) {
        await bg.cleanup();
      }
      throw new CliError(
        `Failed to start "${args[0]}": ${err instanceof Error ? err.message : String(err)}`,
        EXIT.GENERAL
      );
    }

    const onSigint = () => child.kill("SIGINT");
    const onSigterm = () => child.kill("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (flags.timeout > 0) {
      timeoutId = setTimeout(async () => {
        logger.warn(`Timeout: killing child after ${flags.timeout}s`);
        await gracefulKill(child);
      }, flags.timeout * 1000);
    }

    let exitCode: number;
    try {
      exitCode = await new Promise<number>((done, fail) => {
        let settled = false;
        child.on("close", (code) => {
          if (!settled) {
            settled = true;
            done(code ?? 1);
          }
        });
        child.on("error", (err) => {
          logger.debug(`Child process error: ${err.message}`);
          if (!settled) {
            settled = true;
            fail(err);
          }
        });
      });
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      if (bg) {
        await bg.cleanup();
      }
    }

    if (exitCode !== 0) {
      throw new CliError(`Process exited with code ${exitCode}`, exitCode);
    }
  },
});

/** Default timeout for --verify when no explicit --timeout is given. */
const DEFAULT_VERIFY_TIMEOUT_S = 30;

/** Grace period before escalating SIGTERM to SIGKILL. */
const KILL_GRACE_MS = 5000;

/** Send SIGTERM, wait up to {@link KILL_GRACE_MS}, then SIGKILL if still alive. */
async function gracefulKill(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch (error) {
    logger.debug("Child already exited during graceful kill", error);
    return;
  }
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const exited = await Promise.race([
    new Promise<true>((r) => child.on("close", () => r(true))),
    new Promise<false>((r) => {
      graceTimer = setTimeout(() => r(false), KILL_GRACE_MS);
    }),
  ]);
  clearTimeout(graceTimer);
  if (!exited && child.exitCode === null) {
    try {
      child.kill("SIGKILL");
    } catch (error) {
      logger.debug("Child already exited during graceful kill", error);
      return;
    }
    // Only await close if the child hasn't exited yet — avoids hanging
    // if close fired between SIGKILL and listener attachment.
    if (child.exitCode === null) {
      await new Promise<void>((r) => child.on("close", () => r()));
    }
  }
}

/**
 * Run in --verify mode: start a background server, subscribe to the buffer
 * for the first envelope, and race between envelope arrival, timeout,
 * and child exit.
 */
async function* runWithVerify(
  args: string[],
  flags: RunFlags,
  cwd: string,
  commandSource: string
): AsyncGenerator<never, void, unknown> {
  const buffer = createSpotlightBuffer(BUFFER_SIZE);
  const app = buildApp(buffer);
  const { server, port: boundPort } = await tryListen(
    app,
    flags.port,
    flags.host
  );
  const url = `http://${flags.host}:${boundPort}`;
  logger.info(`Verify server listening on ${bold(url)}`);

  const spotlightUrl = `${url}/stream`;

  let subscriptionId: string | undefined;
  const envelopeReceived = new Promise<void>((resolveEnvelope) => {
    subscriptionId = buffer.subscribe(() => {
      resolveEnvelope();
    });
  });

  const childEnv = buildChildEnv(spotlightUrl, commandSource, cwd);

  let child: ChildProcess;
  try {
    const [cmd = "", ...cmdArgs] = args;
    child = spawn(cmd, cmdArgs, {
      cwd,
      env: childEnv,
      stdio: "inherit",
    });
  } catch (err) {
    await shutdownServer(server);
    throw new CliError(
      `Failed to start "${args[0]}": ${err instanceof Error ? err.message : String(err)}`,
      EXIT.GENERAL
    );
  }

  let signalReceived: NodeJS.Signals | null = null;
  const onSigint = () => {
    signalReceived = "SIGINT";
    child.kill("SIGINT");
  };
  const onSigterm = () => {
    signalReceived = "SIGTERM";
    child.kill("SIGTERM");
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  const childExited = new Promise<{ kind: "exited"; code: number }>((r) => {
    child.on("close", (code) =>
      r({ kind: "exited" as const, code: code ?? 1 })
    );
  });

  const verifyTimeout =
    flags.timeout > 0 ? flags.timeout : DEFAULT_VERIFY_TIMEOUT_S;

  const racers: Promise<
    | { kind: "envelope" }
    | { kind: "exited"; code: number }
    | { kind: "timeout" }
  >[] = [
    envelopeReceived.then(() => ({ kind: "envelope" as const })),
    childExited,
  ];

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (verifyTimeout > 0) {
    racers.push(
      new Promise<{ kind: "timeout" }>((r) => {
        timeoutHandle = setTimeout(
          () => r({ kind: "timeout" as const }),
          verifyTimeout * 1000
        );
      })
    );
  }

  let outcome:
    | { kind: "envelope" }
    | { kind: "exited"; code: number }
    | { kind: "timeout" };
  try {
    outcome = await Promise.race(racers);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }

  // Clean up — keep signal handlers active during graceful kill
  try {
    await gracefulKill(child);
  } finally {
    if (subscriptionId) {
      buffer.unsubscribe(subscriptionId);
    }
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await shutdownServer(server);
  }

  // Re-emit the signal after cleanup so the default handler terminates the
  // process instead of continuing with the outcome switch below.
  if (signalReceived) {
    process.kill(process.pid, signalReceived);
    return;
  }

  switch (outcome.kind) {
    case "envelope": {
      logger.info("Setup verified — your app is sending events to Sentry");
      return;
    }
    case "timeout": {
      logger.warn(
        `Verification timed out after ${verifyTimeout}s — no events received from the SDK`
      );
      throw new CliError(
        `Verification timed out after ${verifyTimeout}s`,
        EXIT.WIZARD_VERIFY
      );
    }
    case "exited": {
      if (outcome.code === 0) {
        logger.warn("Process exited before sending any events");
        throw new CliError(
          "Process exited before sending any events",
          EXIT.WIZARD_VERIFY
        );
      }
      logger.warn(`Process crashed with code ${outcome.code}`);
      throw new CliError(
        `Process crashed with code ${outcome.code}`,
        outcome.code
      );
    }
    default: {
      throw new CliError("Unexpected verification outcome", EXIT.GENERAL);
    }
  }
}
