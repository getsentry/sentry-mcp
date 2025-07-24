import type * as Sentry from "@sentry/react";

interface ScrubPattern {
  pattern: RegExp;
  replacement: string;
  description: string;
}

// Patterns for sensitive data that should be scrubbed
const SCRUB_PATTERNS: ScrubPattern[] = [
  {
    pattern: /\bsk-[a-zA-Z0-9]{48}\b/,
    replacement: "[REDACTED_OPENAI_KEY]",
    description: "OpenAI API key",
  },
  {
    pattern: /\bBearer\s+[a-zA-Z0-9\-._~+/]+=*/,
    replacement: "Bearer [REDACTED_TOKEN]",
    description: "Bearer token",
  },
  {
    pattern: /\bsntrys_[a-zA-Z0-9_]+\b/,
    replacement: "[REDACTED_SENTRY_TOKEN]",
    description: "Sentry access token",
  },
];

/**
 * Recursively scrub sensitive data from any value
 */
function scrubValue(value: unknown): unknown {
  if (typeof value === "string") {
    let scrubbed = value;
    for (const { pattern, replacement } of SCRUB_PATTERNS) {
      // Use global flag for replace to replace all occurrences
      scrubbed = scrubbed.replace(new RegExp(pattern.source, "g"), replacement);
    }
    return scrubbed;
  }

  if (Array.isArray(value)) {
    return value.map(scrubValue);
  }

  if (value && typeof value === "object") {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      scrubbed[key] = scrubValue(val);
    }
    return scrubbed;
  }

  return value;
}

/**
 * Sentry beforeSend hook that scrubs sensitive data from events
 */
export function sentryBeforeSend(event: any, hint: any) {
  // Check if the event contains any sensitive patterns
  let containsSensitive = false;

  let eventString: string;
  try {
    eventString = JSON.stringify(event);
  } catch (e) {
    console.error("[Sentry Scrubbing] Failed to stringify event:", e);
    eventString = "";
  }

  for (const { pattern, description } of SCRUB_PATTERNS) {
    if (pattern.test(eventString)) {
      containsSensitive = true;
      console.error(
        `[Sentry Scrubbing] Event contained sensitive data: ${description}`,
      );
    }
  }

  if (!containsSensitive) {
    return event;
  }

  // Deep clone and scrub the event
  const scrubbedEvent = JSON.parse(JSON.stringify(event));

  // Scrub common event properties
  if (scrubbedEvent.message) {
    scrubbedEvent.message = scrubValue(scrubbedEvent.message) as string;
  }

  if (scrubbedEvent.exception?.values) {
    scrubbedEvent.exception.values = scrubbedEvent.exception.values.map(
      (exception: any) => ({
        ...exception,
        value: scrubValue(exception.value),
      }),
    );
  }

  if (scrubbedEvent.request) {
    scrubbedEvent.request = scrubValue(scrubbedEvent.request);
  }

  if (scrubbedEvent.contexts) {
    scrubbedEvent.contexts = scrubValue(scrubbedEvent.contexts);
  }

  if (scrubbedEvent.extra) {
    scrubbedEvent.extra = scrubValue(scrubbedEvent.extra);
  }

  if (scrubbedEvent.tags) {
    scrubbedEvent.tags = scrubValue(scrubbedEvent.tags);
  }

  // Remove breadcrumbs entirely
  scrubbedEvent.breadcrumbs = undefined;

  return scrubbedEvent;
}

/**
 * Add a new pattern to scrub
 */
export function addScrubPattern(
  pattern: RegExp,
  replacement: string,
  description: string,
): void {
  SCRUB_PATTERNS.push({ pattern, replacement, description });
}

/**
 * Get current scrub patterns (for testing)
 */
export function getScrubPatterns(): ReadonlyArray<ScrubPattern> {
  return [...SCRUB_PATTERNS];
}
