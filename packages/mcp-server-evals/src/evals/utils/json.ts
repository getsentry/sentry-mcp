import { toJsonValue, type JsonValue } from "vitest-evals";

export function toJsonRecord(value: unknown): Record<string, JsonValue> {
  const normalized = toJsonValue(value);

  if (
    normalized &&
    typeof normalized === "object" &&
    !Array.isArray(normalized)
  ) {
    return normalized;
  }

  return {};
}

export function requireJsonValue(value: unknown, label: string): JsonValue {
  const normalized = toJsonValue(value);

  if (normalized === undefined) {
    throw new Error(`${label} is not JSON-serializable`);
  }

  return normalized;
}
