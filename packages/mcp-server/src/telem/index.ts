/**
 * Telemetry and observability utilities.
 *
 * This module provides logging, error tracking, and instrumentation utilities
 * for monitoring and debugging MCP server operations.
 */

// Re-export logging utilities
export {
  getLogger,
  logDebug,
  logInfo,
  logWarn,
  logError,
  logIssue,
  type LogIssueOptions,
} from "./logging";

// Re-export Sentry instrumentation utilities
export {
  sentryBeforeSend,
  addScrubPattern,
  getScrubPatterns,
} from "./sentry";
