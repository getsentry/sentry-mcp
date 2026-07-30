import { createJudge, type Judge, type JudgeContext } from "vitest-evals";

interface StructuredOutputJudgeOptions extends JudgeContext<string, string> {
  expected: Record<string, unknown>;
}

/** Judges JSON task output against expected fields using fuzzy eval matching. */
export function StructuredOutputJudge(): Judge<StructuredOutputJudgeOptions> {
  return createJudge<StructuredOutputJudgeOptions>(
    "StructuredOutputJudge",
    ({ output, expected }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(output);
      } catch (error) {
        return {
          score: 0,
          metadata: {
            rationale: `Failed to parse output as JSON: ${error}`,
            output,
          },
        };
      }

      if (!isRecord(parsed)) {
        return {
          score: 0,
          metadata: {
            rationale: "Output JSON must be an object",
            output,
          },
        };
      }

      if (parsed.error && parsed.error !== "" && parsed.error !== null) {
        return {
          score: 0,
          metadata: { rationale: `Output contains error: ${parsed.error}` },
        };
      }

      const mismatches = compareObjects(expected, parsed, fuzzyMatch);
      let rationale: string;

      if (mismatches.length > 0) {
        rationale = `Missing required fields: ${mismatches.map((m) => m.key).join(", ")}`;
      } else {
        rationale = "All expected fields match";
      }

      if (mismatches.length > 0) {
        const details = mismatches
          .map(
            (m) =>
              `${m.key}: expected ${formatValue(m.expected)}, got ${formatValue(m.actual)}`,
          )
          .join("; ");
        rationale += ` - ${details}`;
      }

      return {
        score: mismatches.length > 0 ? 0 : 1,
        metadata: {
          rationale,
          output,
        },
      };
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fuzzyMatch(expected: unknown, actual: unknown): boolean {
  if (expected instanceof RegExp) {
    return typeof actual === "string" && expected.test(actual);
  }

  if (typeof expected === "function") {
    return Boolean((expected as (value: unknown) => unknown)(actual));
  }

  if (
    expected === null ||
    expected === undefined ||
    actual === null ||
    actual === undefined
  ) {
    return expected === actual;
  }

  if (typeof expected === "object" && typeof actual === "object") {
    if (Array.isArray(expected) && Array.isArray(actual)) {
      return arrayFuzzyMatch(expected, actual);
    }

    if (!Array.isArray(expected) && !Array.isArray(actual)) {
      return objectFuzzyMatch(
        expected as Record<string, unknown>,
        actual as Record<string, unknown>,
      );
    }
  }

  if (typeof expected !== typeof actual) {
    return String(expected) === String(actual);
  }

  return expected === actual;
}

function arrayFuzzyMatch(expected: unknown[], actual: unknown[]): boolean {
  if (expected.length !== actual.length) {
    return false;
  }

  return expected.every((item, index) => fuzzyMatch(item, actual[index]));
}

function objectFuzzyMatch(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): boolean {
  return Object.entries(expected).every(([key, value]) =>
    fuzzyMatch(value, actual[key]),
  );
}

interface Mismatch {
  key: string;
  expected: unknown;
  actual: unknown;
}

function compareObjects(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  matchFn: (expected: unknown, actual: unknown, key: string) => boolean,
): Mismatch[] {
  const mismatches: Mismatch[] = [];

  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    if (!matchFn(expectedValue, actualValue, key)) {
      mismatches.push({ key, expected: expectedValue, actual: actualValue });
    }
  }

  return mismatches;
}

function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value instanceof RegExp) return value.toString();
  if (typeof value === "function") return "[validator function]";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
