import { logWarn } from "./logging";

/**
 * Error thrown when an event cannot be serialized for scrubbing
 */
export class EventSerializationError extends Error {
  constructor(
    message: string,
    public readonly originalError: unknown,
  ) {
    super(message);
    this.name = "EventSerializationError";
  }
}

interface ScrubPattern {
  pattern: RegExp;
  globalPattern: RegExp;
  replacement: string;
  description: string;
}

// Patterns for sensitive data that should be scrubbed
// Pre-compile global patterns to avoid regex compilation overhead in scrubbing loop
const SCRUB_PATTERNS: ScrubPattern[] = [
  {
    pattern: /\bsk-[a-zA-Z0-9]{48}\b/,
    globalPattern: /\bsk-[a-zA-Z0-9]{48}\b/g,
    replacement: "[REDACTED_OPENAI_KEY]",
    description: "OpenAI API key",
  },
  {
    pattern: /\bBearer\s+[a-zA-Z0-9\-._~+/]+=*/,
    globalPattern: /\bBearer\s+[a-zA-Z0-9\-._~+/]+={0,}/g,
    replacement: "Bearer [REDACTED_TOKEN]",
    description: "Bearer token",
  },
  {
    pattern: /\bsntrys_[a-zA-Z0-9_]+\b/,
    globalPattern: /\bsntrys_[a-zA-Z0-9_]+\b/g,
    replacement: "[REDACTED_SENTRY_TOKEN]",
    description: "Sentry access token",
  },
];

// Maximum depth for recursive scrubbing to prevent stack overflow
const MAX_SCRUB_DEPTH = 20;

/**
 * Recursively scrub sensitive data from any value
 */
function scrubValue(value: unknown, depth = 0): unknown {
  // Prevent stack overflow by limiting recursion depth
  if (depth >= MAX_SCRUB_DEPTH) {
    return "[MAX_DEPTH_EXCEEDED]";
  }

  if (typeof value === "string") {
    let scrubbed = value;
    for (const { globalPattern, replacement } of SCRUB_PATTERNS) {
      // Use pre-compiled global pattern to avoid regex compilation overhead
      scrubbed = scrubbed.replace(globalPattern, replacement);
    }
    return scrubbed;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1));
  }

  if (value && typeof value === "object") {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      scrubbed[key] = scrubValue(val, depth + 1);
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
    throw new EventSerializationError(
      "[Sentry Scrubbing] Cannot serialize event for sensitive data check",
      e,
    );
  }

  for (const { pattern, description } of SCRUB_PATTERNS) {
    if (pattern.test(eventString)) {
      containsSensitive = true;
      logWarn(`Event contained sensitive data: ${description}`, {
        loggerScope: ["security", "scrubbing"],
        contexts: {
          scrubbing: {
            description,
          },
        },
      });
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
  // Create global version of the pattern
  const globalPattern = new RegExp(pattern.source, "g");
  SCRUB_PATTERNS.push({ pattern, globalPattern, replacement, description });
}

/**
 * Get current scrub patterns (for testing)
 */
export function getScrubPatterns(): ReadonlyArray<ScrubPattern> {
  return [...SCRUB_PATTERNS];
}
