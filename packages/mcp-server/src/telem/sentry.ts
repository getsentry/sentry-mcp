import { logWarn } from "./logging";

interface ScrubPattern {
  pattern: RegExp;
  replacement: string;
  description: string;
}

// Patterns for sensitive data that should be scrubbed
// Pre-compile patterns with global flag for replacement
const SCRUB_PATTERNS: ScrubPattern[] = [
  {
    pattern: /\bsk-[a-zA-Z0-9]{48}\b/g,
    replacement: "[REDACTED_OPENAI_KEY]",
    description: "OpenAI API key",
  },
  {
    pattern: /\bBearer\s+[a-zA-Z0-9\-._~+/]+={0,}/g,
    replacement: "Bearer [REDACTED_TOKEN]",
    description: "Bearer token",
  },
  {
    pattern: /\bsntrys_[a-zA-Z0-9_]+\b/g,
    replacement: "[REDACTED_SENTRY_TOKEN]",
    description: "Sentry access token",
  },
];

// Maximum depth for recursive scrubbing to prevent stack overflow
const MAX_SCRUB_DEPTH = 20;

/**
 * Recursively scrub sensitive data from any value.
 * Returns tuple of [scrubbedValue, didScrub, descriptionsOfMatchedPatterns]
 */
function scrubValue(value: unknown, depth = 0): [unknown, boolean, string[]] {
  // Prevent stack overflow by limiting recursion depth
  if (depth >= MAX_SCRUB_DEPTH) {
    return ["[MAX_DEPTH_EXCEEDED]", false, []];
  }

  if (typeof value === "string") {
    let scrubbed = value;
    let didScrub = false;
    const matchedDescriptions: string[] = [];

    for (const { pattern, replacement, description } of SCRUB_PATTERNS) {
      // Reset lastIndex to avoid stateful regex issues
      pattern.lastIndex = 0;
      if (pattern.test(scrubbed)) {
        didScrub = true;
        matchedDescriptions.push(description);
        // Reset again before replace
        pattern.lastIndex = 0;
        scrubbed = scrubbed.replace(pattern, replacement);
      }
    }
    return [scrubbed, didScrub, matchedDescriptions];
  }

  if (Array.isArray(value)) {
    let arrayDidScrub = false;
    const arrayDescriptions: string[] = [];
    const scrubbedArray = value.map((item) => {
      const [scrubbed, didScrub, descriptions] = scrubValue(item, depth + 1);
      if (didScrub) {
        arrayDidScrub = true;
        arrayDescriptions.push(...descriptions);
      }
      return scrubbed;
    });
    return [scrubbedArray, arrayDidScrub, arrayDescriptions];
  }

  if (value && typeof value === "object") {
    let objectDidScrub = false;
    const objectDescriptions: string[] = [];
    const scrubbed: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const [scrubbedVal, didScrub, descriptions] = scrubValue(val, depth + 1);
      if (didScrub) {
        objectDidScrub = true;
        objectDescriptions.push(...descriptions);
      }
      scrubbed[key] = scrubbedVal;
    }
    return [scrubbed, objectDidScrub, objectDescriptions];
  }

  return [value, false, []];
}

/**
 * Sentry beforeSend hook that scrubs sensitive data from events
 */
export function sentryBeforeSend(event: any, hint: any): any {
  // Always scrub the entire event
  const [scrubbedEvent, didScrub, descriptions] = scrubValue(event);

  // Log if we found and scrubbed sensitive data
  if (didScrub) {
    // Get unique descriptions
    const uniqueDescriptions = [...new Set(descriptions)];
    logWarn(
      `Event contained sensitive data: ${uniqueDescriptions.join(", ")}`,
      {
        loggerScope: ["security", "scrubbing"],
        extra: {
          patterns_matched: uniqueDescriptions,
        },
      },
    );
  }

  return scrubbedEvent as any;
}

/**
 * Add a new pattern to scrub
 */
export function addScrubPattern(
  pattern: RegExp,
  replacement: string,
  description: string,
): void {
  // Ensure pattern has global flag
  const globalPattern = pattern.global
    ? pattern
    : new RegExp(pattern.source, "g");
  SCRUB_PATTERNS.push({ pattern: globalPattern, replacement, description });
}

/**
 * Get current scrub patterns (for testing)
 */
export function getScrubPatterns(): ReadonlyArray<ScrubPattern> {
  return [...SCRUB_PATTERNS];
}
