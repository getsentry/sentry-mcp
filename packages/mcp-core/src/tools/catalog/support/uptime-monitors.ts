import { z } from "zod";
import type { UptimeMonitor } from "../../../api-client/types";
import { formatActor } from "./api-formatting";

/** Verified against UptimeSubscription.IntervalSeconds in getsentry/sentry. */
export const UPTIME_INTERVAL_SECONDS = [
  60, 300, 600, 1200, 1800, 3600,
] as const;

/** Verified against UptimeSubscription.SupportedHTTPMethods in getsentry/sentry. */
export const UPTIME_HTTP_METHODS = [
  "GET",
  "POST",
  "HEAD",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
] as const;

export const UPTIME_MONITOR_STATUSES = ["active", "disabled"] as const;

export const ParamUptimeIntervalSeconds = z
  .number()
  .int()
  .refine(
    (value): value is (typeof UPTIME_INTERVAL_SECONDS)[number] =>
      (UPTIME_INTERVAL_SECONDS as readonly number[]).includes(value),
    {
      message: `intervalSeconds must be one of: ${UPTIME_INTERVAL_SECONDS.join(", ")}`,
    },
  )
  .describe(
    "Seconds between checks. Allowed values: 60, 300, 600, 1200, 1800, 3600.",
  );

export const ParamUptimeHttpMethod = z
  .enum(UPTIME_HTTP_METHODS)
  .describe("HTTP method used for the uptime check request.");

export const ParamUptimeMonitorStatus = z
  .enum(UPTIME_MONITOR_STATUSES)
  .describe(
    "Monitor status. `disabled` stops checks and does not count against quota.",
  );

export const ParamUptimeTimeoutMs = z
  .number()
  .int()
  .min(1000)
  .max(60_000)
  .describe("Request timeout in milliseconds (1000-60000).");

export const ParamUptimeHeaders = z
  .array(z.tuple([z.string(), z.string()]))
  .describe(
    'Optional HTTP headers as an array of [name, value] pairs, e.g. [["Accept","application/json"]].',
  );

/** Owner actor for create/update. Empty/whitespace rejected. */
export const ParamUptimeOwner = z
  .string()
  .trim()
  .min(1)
  .regex(
    /^(user|team):.+$/,
    "owner must use `user:ID` or `team:ID` format (e.g. `user:123` or `team:456`).",
  )
  .describe("Owner actor in `user:ID` or `team:ID` format.");

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
  "x-csrf-token",
  "x-sentry-auth",
]);

export function isSensitiveHeaderName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (SENSITIVE_HEADER_NAMES.has(normalized)) {
    return true;
  }
  return (
    normalized.includes("authorization") ||
    normalized.includes("api-key") ||
    normalized.includes("access-token") ||
    normalized.includes("secret") ||
    normalized.includes("password")
  );
}

/**
 * Format headers for tool output without leaking secrets.
 * Malformed short arrays are skipped. Sensitive values are redacted.
 */
export function formatUptimeHeadersForOutput(headers: unknown): string[] {
  if (!Array.isArray(headers) || headers.length === 0) {
    return [];
  }

  const lines: string[] = [];
  for (const header of headers) {
    if (!Array.isArray(header) || header.length < 2) {
      continue;
    }
    const name = header[0];
    const value = header[1];
    if (typeof name !== "string" || typeof value !== "string") {
      continue;
    }
    const displayValue = isSensitiveHeaderName(name) ? "[REDACTED]" : value;
    lines.push(`- ${name}: ${displayValue}`);
  }
  return lines;
}

export const uptimeMonitorSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  projectSlug: z.string(),
  status: z.string(),
  uptimeStatus: z.union([z.number(), z.string(), z.null()]),
  url: z.string(),
  method: z.string().nullable(),
  intervalSeconds: z.number(),
  timeoutMs: z.number(),
  environment: z.string().nullable(),
  owner: z.string().nullable(),
  recoveryThreshold: z.number().nullable(),
  downtimeThreshold: z.number().nullable(),
  traceSampling: z.boolean().nullable(),
  responseCaptureEnabled: z.boolean().nullable(),
  webUrl: z.string().url(),
});

export type UptimeMonitorSummary = z.infer<typeof uptimeMonitorSummarySchema>;

export function getUptimeOwnerName(
  monitor: Pick<UptimeMonitor, "owner">,
): string | null {
  if (!monitor.owner) {
    return null;
  }
  const formatted = formatActor(monitor.owner);
  return formatted === "unknown" ? null : formatted;
}

export function toUptimeMonitorSummary(
  monitor: UptimeMonitor,
  webUrl: string,
): UptimeMonitorSummary {
  return {
    id: String(monitor.id),
    name: monitor.name,
    projectSlug: monitor.projectSlug,
    status: monitor.status,
    uptimeStatus: monitor.uptimeStatus ?? null,
    url: monitor.url,
    method: monitor.method ?? null,
    intervalSeconds: monitor.intervalSeconds,
    timeoutMs: monitor.timeoutMs,
    environment: monitor.environment ?? null,
    owner: getUptimeOwnerName(monitor),
    recoveryThreshold: monitor.recoveryThreshold ?? null,
    downtimeThreshold: monitor.downtimeThreshold ?? null,
    traceSampling: monitor.traceSampling ?? null,
    responseCaptureEnabled: monitor.responseCaptureEnabled ?? null,
    webUrl,
  };
}

export function formatUptimeStatus(value: unknown): string | null {
  if (value === 1 || value === "1" || value === "ok") {
    return "ok";
  }
  if (value === 2 || value === "2" || value === "failed") {
    return "failed";
  }
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}
