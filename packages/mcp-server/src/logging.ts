/**
 * Logging and telemetry utilities for error reporting.
 *
 * Provides centralized error logging with Sentry integration. Handles both
 * console logging for development and structured error reporting for production
 * monitoring and debugging.
 */
import {
  configureSync,
  getConfig,
  getConsoleSink,
  getJsonLinesFormatter,
  getLogger as getLogTapeLogger,
  parseLogLevel,
  type LogLevel,
  type Logger,
} from "@logtape/logtape";
import { getSentrySink } from "@logtape/sentry";
import { captureException, captureMessage, withScope } from "@sentry/core";

const ROOT_LOG_CATEGORY = ["sentry", "mcp"] as const;

type SinkId = "console" | "sentry";

let loggingConfigured = false;

function resolveLowestLevel(): LogLevel {
  const envLevel =
    (typeof process !== "undefined" && process.env.MCP_LOG_LEVEL) ||
    (typeof process !== "undefined" && process.env.LOG_LEVEL);

  if (envLevel) {
    try {
      return parseLogLevel(envLevel);
    } catch (error) {
      // Fall through to default level when parsing fails.
    }
  }

  return typeof process !== "undefined" &&
    process.env.NODE_ENV === "development"
    ? "debug"
    : "info";
}

function ensureLoggingConfigured(): void {
  if (loggingConfigured) {
    return;
  }

  const consoleSink = getConsoleSink({
    formatter: getJsonLinesFormatter(),
  });
  const sentrySink = getSentrySink();

  configureSync<SinkId, never>({
    reset: getConfig() !== null,
    sinks: {
      console: consoleSink,
      sentry: sentrySink,
    },
    loggers: [
      {
        category: [...ROOT_LOG_CATEGORY],
        sinks: ["console", "sentry"],
        lowestLevel: resolveLowestLevel(),
      },
      {
        category: "logtape",
        sinks: ["console"],
        lowestLevel: "error",
      },
    ],
  });

  loggingConfigured = true;
}

export type LogContext = Record<string, unknown>;

export type SentryLogContexts = Record<string, Record<string, unknown>>;
export type LogAttachments = Record<string, string | Uint8Array>;

export interface BaseLogOptions {
  contexts?: SentryLogContexts;
  extra?: LogContext;
  loggerScope?: string | readonly string[];
}

export interface LogIssueOptions extends BaseLogOptions {
  attachments?: LogAttachments;
}

export interface LogOptions extends BaseLogOptions {}

export function getLogger(
  scope: string | readonly string[],
  defaults?: LogContext,
): Logger {
  ensureLoggingConfigured();

  const category = Array.isArray(scope) ? scope : [scope];
  const logger = getLogTapeLogger([...ROOT_LOG_CATEGORY, ...category]);

  return defaults ? logger.with(defaults) : logger;
}

const ISSUE_LOGGER_SCOPE = ["runtime", "issues"] as const;

interface ParsedBaseOptions {
  contexts?: SentryLogContexts;
  extra?: LogContext;
  loggerScope?: string | readonly string[];
}

interface ParsedLogIssueOptions extends ParsedBaseOptions {
  attachments?: LogAttachments;
}

interface SerializedError {
  message: string;
  name?: string;
  stack?: string;
  cause?: SerializedError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSentryContexts(value: unknown): value is SentryLogContexts {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((entry) => isRecord(entry));
}

function isBaseLogOptionsCandidate(value: unknown): value is BaseLogOptions {
  if (!isRecord(value)) {
    return false;
  }

  if ("extra" in value || "loggerScope" in value) {
    return true;
  }

  if ("contexts" in value) {
    const contexts = (value as { contexts?: unknown }).contexts;
    return contexts === undefined || isSentryContexts(contexts);
  }

  return false;
}

function isLogIssueOptionsCandidate(value: unknown): value is LogIssueOptions {
  return (
    isBaseLogOptionsCandidate(value) ||
    (isRecord(value) && "attachments" in value)
  );
}

function parseBaseOptions(
  contextsOrOptions?: SentryLogContexts | BaseLogOptions,
): ParsedBaseOptions {
  if (isBaseLogOptionsCandidate(contextsOrOptions)) {
    const { contexts, extra, loggerScope } = contextsOrOptions;
    return {
      contexts,
      extra,
      loggerScope,
    };
  }

  if (isSentryContexts(contextsOrOptions)) {
    return { contexts: contextsOrOptions };
  }

  return {};
}

function parseLogIssueOptions(
  contextsOrOptions?: SentryLogContexts | LogIssueOptions,
  attachmentsArg?: LogAttachments,
): ParsedLogIssueOptions {
  const base = parseBaseOptions(contextsOrOptions);

  const attachments = isLogIssueOptionsCandidate(contextsOrOptions)
    ? contextsOrOptions.attachments
    : undefined;

  return {
    ...base,
    attachments: attachments ?? attachmentsArg,
  };
}

function parseLogOptions(
  contextsOrOptions?: SentryLogContexts | LogOptions,
): LogOptions {
  return parseBaseOptions(contextsOrOptions);
}

function safeJsonStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return undefined;
  }
}

function truncate(text: string, maxLength = 1024): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function coerceMessage(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value.toString();
  }

  if (value === null || value === undefined) {
    return String(value);
  }

  const json = safeJsonStringify(value);
  if (json) {
    return truncate(json);
  }

  return Object.prototype.toString.call(value);
}

function serializeError(value: unknown, depth = 0): SerializedError {
  if (value instanceof Error) {
    const serialized: SerializedError = {
      message: value.message,
    };

    if (value.name && value.name !== "Error") {
      serialized.name = value.name;
    }

    if (typeof value.stack === "string") {
      serialized.stack = value.stack;
    }

    const hasCause =
      "cause" in (value as { cause?: unknown }) &&
      (value as { cause?: unknown }).cause !== undefined;

    if (hasCause && depth < 3) {
      const cause = (value as { cause?: unknown }).cause;
      serialized.cause = serializeError(cause, depth + 1);
    }

    return serialized;
  }

  return { message: coerceMessage(value) };
}

export const logger = getLogger([]);

const DEFAULT_LOGGER_SCOPE: readonly string[] = [];

function buildLogProperties(
  level: LogLevel,
  options: ParsedBaseOptions,
  serializedError?: SerializedError,
): LogContext {
  const properties: LogContext = {
    severity: level,
  };

  if (serializedError) {
    properties.error = serializedError;
  }

  if (options.extra) {
    Object.assign(properties, options.extra);
  }

  if (options.contexts) {
    properties.sentryContexts = options.contexts;
  }

  return properties;
}

function logWithLevel(
  level: LogLevel,
  value: unknown,
  contextsOrOptions?: SentryLogContexts | LogOptions,
): void {
  ensureLoggingConfigured();

  const options = parseLogOptions(contextsOrOptions);
  const serializedError =
    value instanceof Error ? serializeError(value) : undefined;
  const message = serializedError
    ? serializedError.message
    : coerceMessage(value);
  const scope = options.loggerScope ?? DEFAULT_LOGGER_SCOPE;
  const scopedLogger = getLogger(scope, { severity: level });

  const properties = buildLogProperties(level, options, serializedError);

  switch (level) {
    case "trace":
      scopedLogger.trace(message, () => properties);
      break;
    case "debug":
      scopedLogger.debug(message, () => properties);
      break;
    case "info":
      scopedLogger.info(message, () => properties);
      break;
    case "warning":
      scopedLogger.warn(message, () => properties);
      break;
    case "error":
      scopedLogger.error(message, () => properties);
      break;
    case "fatal":
      scopedLogger.fatal(message, () => properties);
      break;
    default:
      scopedLogger.info(message, () => properties);
  }
}

export function logDebug(
  value: unknown,
  contextsOrOptions?: SentryLogContexts | LogOptions,
): void {
  logWithLevel("debug", value, contextsOrOptions);
}

export function logInfo(
  value: unknown,
  contextsOrOptions?: SentryLogContexts | LogOptions,
): void {
  logWithLevel("info", value, contextsOrOptions);
}

export function logWarn(
  value: unknown,
  contextsOrOptions?: SentryLogContexts | LogOptions,
): void {
  logWithLevel("warning", value, contextsOrOptions);
}

export function logError(
  value: unknown,
  contextsOrOptions?: SentryLogContexts | LogOptions,
): void {
  logWithLevel("error", value, contextsOrOptions);
}

export function logIssue(
  error: Error | unknown,
  contexts?: SentryLogContexts,
  attachments?: LogAttachments,
): string | undefined;
export function logIssue(
  error: Error | unknown,
  options: LogIssueOptions,
): string | undefined;
export function logIssue(
  message: string,
  contexts?: SentryLogContexts,
  attachments?: LogAttachments,
): string | undefined;
export function logIssue(
  message: string,
  options: LogIssueOptions,
): string | undefined;
export function logIssue(
  error: unknown,
  contextsOrOptions?: SentryLogContexts | LogIssueOptions,
  attachmentsArg?: LogAttachments,
): string | undefined {
  ensureLoggingConfigured();

  const options = parseLogIssueOptions(contextsOrOptions, attachmentsArg);
  const eventId = withScope((scopeInstance) => {
    if (options.contexts) {
      for (const [key, context] of Object.entries(options.contexts)) {
        scopeInstance.setContext(key, context);
      }
    }

    if (options.extra) {
      scopeInstance.setContext("log", options.extra);
    }

    if (options.attachments) {
      for (const [key, data] of Object.entries(options.attachments)) {
        scopeInstance.addAttachment({
          data,
          filename: key,
        });
      }
    }

    const captureLevel = "error" as const;

    return typeof error === "string"
      ? captureMessage(error, {
          contexts: options.contexts,
          level: captureLevel,
        })
      : captureException(error, {
          contexts: options.contexts,
          level: captureLevel,
        });
  });

  const { attachments, ...baseOptions } = options;
  const extra: LogContext = {
    ...(baseOptions.extra ?? {}),
    ...(attachments && Object.keys(attachments).length > 0
      ? { attachments: Object.keys(attachments) }
      : {}),
    ...(eventId ? { eventId } : {}),
  };

  logError(error, {
    ...baseOptions,
    extra,
    loggerScope: baseOptions.loggerScope ?? ISSUE_LOGGER_SCOPE,
  });

  return eventId;
}
