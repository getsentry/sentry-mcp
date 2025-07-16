import type { SentryApiService } from "../../api-client";
import { logError } from "../../logging";

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
