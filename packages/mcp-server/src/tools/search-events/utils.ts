import { tool } from "ai";
import { z } from "zod";
import type { SentryApiService } from "../../api-client";
import { logError } from "../../logging";
import { UserInputError } from "../../errors";
import { wrapAgentToolExecute } from "../../agent-tools/utils";

// Type for flexible event data that can contain any fields
export type FlexibleEventData = Record<string, unknown>;

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

  try {
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
        if (attr.key) {
          customAttributes[attr.key] = attr.name || attr.key;
          // Track field type from the attribute response with validation
          if (attr.type && (attr.type === "string" || attr.type === "number")) {
            fieldTypes[attr.key] = attr.type;
          }
        }
      }
    }
  } catch (error) {
    // If we can't get custom attributes, continue with just common fields
    logError(error, {
      search_events: {
        dataset,
        organizationSlug,
        operation:
          dataset === "errors" ? "listTags" : "listTraceItemAttributes",
        ...(dataset !== "errors" && {
          itemType: dataset === "logs" ? "logs" : "spans",
        }),
      },
    });
  }

  return { attributes: customAttributes, fieldTypes };
}

/**
 * Create a tool for the agent to query available attributes by dataset
 */
export function createDatasetAttributesTool(
  apiService: SentryApiService,
  organizationSlug: string,
  projectId?: string,
) {
  return tool({
    description:
      "Query available attributes and fields for a specific Sentry dataset to understand what data is available",
    parameters: z.object({
      dataset: z
        .enum(["spans", "errors", "logs"])
        .describe("The dataset to query attributes for"),
    }),
    execute: wrapAgentToolExecute(async ({ dataset }) => {
      const {
        BASE_COMMON_FIELDS,
        DATASET_FIELDS,
        RECOMMENDED_FIELDS,
        NUMERIC_FIELDS,
      } = await import("./config");

      // Get custom attributes for this dataset
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

Use this information to construct appropriate queries for the ${dataset} dataset.`;
    }),
  });
}
