import { z } from "zod";
import type { SentryApiService } from "../../api-client";
import { agentTool } from "../../internal/agents/tools/utils";

// Type for flexible event data that can contain any fields
export type FlexibleEventData = Record<string, unknown>;

const DEFAULT_MAX_VALUE_LENGTH = 200;
const DEFAULT_MAX_ARRAY_ITEMS = 20;

// Helper to safely get a string value from event data
export function getStringValue(
  event: FlexibleEventData,
  key: string,
  defaultValue = "",
): string {
  const value = event[key];
  return typeof value === "string" ? value : defaultValue;
}

// Helper to safely get a number value from event data
export function getNumberValue(
  event: FlexibleEventData,
  key: string,
): number | undefined {
  const value = event[key];
  return typeof value === "number" ? value : undefined;
}

// Helper to check if fields contain aggregate functions
export function isAggregateQuery(fields: string[]): boolean {
  return fields.some((field) => field.includes("(") && field.includes(")"));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitive(
  value: unknown,
): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isTagPair(value: unknown): value is { key: string; value: unknown } {
  return (
    isPlainObject(value) && typeof value.key === "string" && "value" in value
  );
}

const USER_FIELDS = ["id", "email", "username", "ip_address", "name"] as const;
const USER_IDENTITY_FIELDS = new Set([
  "email",
  "username",
  "ip_address",
  "name",
]);

function formatUserSummary(value: Record<string, unknown>): string | null {
  // Require at least one identity field to avoid matching arbitrary objects that just have "id"
  const hasIdentityField = USER_FIELDS.some(
    (f) => USER_IDENTITY_FIELDS.has(f) && value[f] != null,
  );
  if (!hasIdentityField) {
    return null;
  }

  const parts = USER_FIELDS.filter((f) => value[f] != null).map(
    (f) => `${f}=${formatSimpleValue(value[f])}`,
  );

  return parts.length > 0 ? parts.join(", ") : null;
}

function sanitizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, currentValue) => {
    if (typeof currentValue === "bigint") {
      return currentValue.toString();
    }

    if (typeof currentValue === "function") {
      return "[Function]";
    }

    if (typeof currentValue === "object" && currentValue !== null) {
      if (seen.has(currentValue)) {
        return "[Circular]";
      }
      seen.add(currentValue);
    }

    return currentValue;
  });
}

function formatSimpleValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return safeJsonStringify(value);
}

function formatArrayValue(values: unknown[], maxLength: number): string {
  if (values.length === 0) {
    return "[]";
  }

  if (values.every(isTagPair)) {
    const pairs = values.map(
      (tag) => `${tag.key}=${formatSimpleValue(tag.value)}`,
    );
    return truncateString(sanitizeWhitespace(pairs.join(", ")), maxLength);
  }

  if (values.every(isPrimitive)) {
    return truncateString(
      sanitizeWhitespace(values.map((value) => String(value)).join(", ")),
      maxLength,
    );
  }

  const overflow = values.length > DEFAULT_MAX_ARRAY_ITEMS;
  const limitedValues = overflow
    ? values.slice(0, DEFAULT_MAX_ARRAY_ITEMS)
    : values;
  const jsonValue = safeJsonStringify(limitedValues);
  const suffix = overflow
    ? `, ...+${values.length - DEFAULT_MAX_ARRAY_ITEMS} more`
    : "";

  return truncateString(sanitizeWhitespace(`${jsonValue}${suffix}`), maxLength);
}

function formatObjectValue(
  value: Record<string, unknown>,
  maxLength: number,
): string {
  // Check tag pair first -- it's more specific than the user summary heuristic
  if (isTagPair(value)) {
    return truncateString(
      sanitizeWhitespace(`${value.key}=${formatSimpleValue(value.value)}`),
      maxLength,
    );
  }

  const userSummary = formatUserSummary(value);
  if (userSummary) {
    return truncateString(sanitizeWhitespace(userSummary), maxLength);
  }

  return truncateString(
    sanitizeWhitespace(safeJsonStringify(value)),
    maxLength,
  );
}

export function formatEventValue(
  value: unknown,
  options: { maxLength?: number } = {},
): string {
  const maxLength = options.maxLength ?? DEFAULT_MAX_VALUE_LENGTH;

  if (value === null) return "null";
  if (value === undefined) return "undefined";

  if (typeof value === "string") {
    return truncateString(sanitizeWhitespace(value), maxLength);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return formatArrayValue(value, maxLength);
  }

  if (isPlainObject(value)) {
    return formatObjectValue(value, maxLength);
  }

  return truncateString(sanitizeWhitespace(String(value)), maxLength);
}

// Helper function to fetch custom attributes for a dataset
export async function fetchCustomAttributes(
  apiService: SentryApiService,
  organizationSlug: string,
  dataset: "errors" | "logs" | "spans",
  projectId?: string,
  timeParams?: { statsPeriod?: string; start?: string; end?: string },
): Promise<{
  attributes: Record<string, string>;
  fieldTypes: Record<string, "string" | "number">;
}> {
  const customAttributes: Record<string, string> = {};
  const fieldTypes: Record<string, "string" | "number"> = {};

  if (dataset === "errors") {
    // TODO: For errors dataset, we currently need to use the old listTags API
    // This will be updated in the future to use the new trace-items attributes API
    const tagsResponse = await apiService.listTags({
      organizationSlug,
      dataset: "events",
      project: projectId,
      statsPeriod: "14d",
      useCache: true,
      useFlagsBackend: true,
    });

    for (const tag of tagsResponse) {
      if (tag.key && !tag.key.startsWith("sentry:")) {
        customAttributes[tag.key] = tag.name || tag.key;
      }
    }
  } else {
    // For logs and spans datasets, use the trace-items attributes endpoint
    const itemType = dataset === "logs" ? "logs" : "spans";
    const attributesResponse = await apiService.listTraceItemAttributes({
      organizationSlug,
      itemType,
      project: projectId,
      statsPeriod: "14d",
    });

    for (const attr of attributesResponse) {
      if (attr.key && !attr.key.startsWith("sentry:")) {
        customAttributes[attr.key] = attr.name || attr.key;
        // Track field type from the attribute response with validation
        if (attr.type && (attr.type === "string" || attr.type === "number")) {
          fieldTypes[attr.key] = attr.type;
        }
      }
    }
  }

  return { attributes: customAttributes, fieldTypes };
}

/**
 * Create a tool for the agent to query available attributes by dataset
 * The tool is pre-bound with the API service and organization configured for the appropriate region
 */
export function createDatasetAttributesTool(options: {
  apiService: SentryApiService;
  organizationSlug: string;
  projectId?: string;
}) {
  const { apiService, organizationSlug, projectId } = options;
  return agentTool({
    description:
      "Query available attributes and fields for a specific Sentry dataset to understand what data is available",
    parameters: z.object({
      dataset: z
        .enum(["spans", "errors", "logs"])
        .describe("The dataset to query attributes for"),
    }),
    execute: async ({ dataset }) => {
      const {
        BASE_COMMON_FIELDS,
        DATASET_FIELDS,
        RECOMMENDED_FIELDS,
        NUMERIC_FIELDS,
        DATASET_EXAMPLES,
      } = await import("./config");

      // Get custom attributes for this dataset
      // IMPORTANT: Let ALL errors bubble up to wrapAgentToolExecute
      // UserInputError will be converted to error string for the AI agent
      // Other errors will bubble up to be captured by Sentry
      const { attributes: customAttributes, fieldTypes } =
        await fetchCustomAttributes(
          apiService,
          organizationSlug,
          dataset,
          projectId,
        );

      // Combine all available fields
      const allFields = {
        ...BASE_COMMON_FIELDS,
        ...DATASET_FIELDS[dataset],
        ...customAttributes,
      };

      const recommendedFields = RECOMMENDED_FIELDS[dataset];

      // Combine field types from both static config and dynamic API
      const allFieldTypes = { ...fieldTypes };
      const staticNumericFields = NUMERIC_FIELDS[dataset] || new Set();
      for (const field of staticNumericFields) {
        allFieldTypes[field] = "number";
      }

      return `Dataset: ${dataset}

Available Fields (${Object.keys(allFields).length} total):
${Object.entries(allFields)
  .slice(0, 50) // Limit to first 50 to avoid overwhelming the agent
  .map(([key, desc]) => `- ${key}: ${desc}`)
  .join("\n")}
${Object.keys(allFields).length > 50 ? `\n... and ${Object.keys(allFields).length - 50} more fields` : ""}

Recommended Fields for ${dataset}:
${recommendedFields.basic.map((f) => `- ${f}`).join("\n")}

Field Types (CRITICAL for aggregate functions):
${Object.entries(allFieldTypes)
  .slice(0, 30) // Show more field types since this is critical for validation
  .map(([key, type]) => `- ${key}: ${type}`)
  .join("\n")}
${Object.keys(allFieldTypes).length > 30 ? `\n... and ${Object.keys(allFieldTypes).length - 30} more fields` : ""}

IMPORTANT: Only use numeric aggregate functions (avg, sum, min, max, percentiles) with numeric fields. Use count() or count_unique() for non-numeric fields.

EXAMPLE QUERIES FOR ${dataset.toUpperCase()}:
${DATASET_EXAMPLES[dataset]
  .map((ex) => `- "${ex.description}" →\n  ${JSON.stringify(ex.output)}`)
  .join("\n\n")}

Use these examples as patterns for constructing your query.`;
    },
  });
}
