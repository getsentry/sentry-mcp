import { z } from "zod";
import type { SentryApiService } from "../../../api-client";
import { agentTool } from "./utils";

export type DatasetType = "events" | "errors" | "search_issues";

export interface DatasetField {
  key: string;
  name: string;
  totalValues: number;
  examples?: string[];
}

export interface DatasetFieldsResult {
  dataset: string;
  fields: DatasetField[];
  commonPatterns: Array<{ pattern: string; description: string }>;
}

/**
 * Discover available fields for a dataset by querying Sentry's tags API
 */
export async function discoverDatasetFields(
  apiService: SentryApiService,
  organizationSlug: string,
  dataset: DatasetType,
  options: {
    projectId?: string;
    includeExamples?: boolean;
  } = {},
): Promise<DatasetFieldsResult> {
  const { projectId, includeExamples = false } = options;

  // Get available tags for the dataset
  const tags = await apiService.listTags({
    organizationSlug,
    dataset,
    project: projectId,
    statsPeriod: "14d",
  });

  // Filter out internal Sentry tags and format
  const fields = tags
    .filter((tag) => !tag.key.startsWith("sentry:"))
    .map((tag) => ({
      key: tag.key,
      name: tag.name,
      totalValues: tag.totalValues,
      examples: includeExamples
        ? getFieldExamples(tag.key, dataset)
        : undefined,
    }));

  return {
    dataset,
    fields,
    commonPatterns: getCommonPatterns(dataset),
  };
}

/**
 * Create a tool for discovering available fields in a dataset
 */
export function createDatasetFieldsTool(
  apiService: SentryApiService,
  organizationSlug: string,
  dataset: DatasetType,
  projectId?: string,
) {
  return agentTool({
    description: `Discover available fields for ${dataset} searches in Sentry`,
    parameters: z.object({
      includeExamples: z
        .boolean()
        .describe(
          "Include example values for each field (set to false if you don't need examples)",
        ),
    }),
    execute: async ({ includeExamples }) => {
      return discoverDatasetFields(apiService, organizationSlug, dataset, {
        projectId,
        includeExamples,
      });
    },
  });
}

/**
 * Get example values for common fields
 */
export function getFieldExamples(
  key: string,
  dataset: string,
): string[] | undefined {
  const commonExamples: Record<string, string[]> = {
    level: ["error", "warning", "info", "debug", "fatal"],
    environment: ["production", "staging", "development"],
    release: ["v1.0.0", "latest", "backend@1.2.3"],
    user: ["user123", "email@example.com"],
  };

  const issueExamples: Record<string, string[]> = {
    ...commonExamples,
    assignedOrSuggested: ["email@example.com", "team-slug", "me"],
    is: ["unresolved", "resolved", "ignored"],
  };

  const eventExamples: Record<string, string[]> = {
    ...commonExamples,
    "http.method": ["GET", "POST", "PUT", "DELETE"],
    "http.status_code": ["200", "404", "500"],
    "db.system": ["postgresql", "mysql", "redis"],
  };

  if (dataset === "search_issues") {
    return issueExamples[key];
  }
  if (dataset === "events" || dataset === "errors") {
    return eventExamples[key];
  }

  return commonExamples[key];
}

/**
 * Get common search patterns for a dataset
 */
export function getCommonPatterns(dataset: string) {
  if (dataset === "search_issues") {
    return [
      { pattern: "is:unresolved", description: "Open issues" },
      { pattern: "is:resolved", description: "Closed issues" },
      { pattern: "level:error", description: "Error level issues" },
      {
        pattern: "firstSeen:-24h",
        description: "New issues from last 24 hours",
      },
      {
        pattern: "userCount:>100",
        description: "Affecting more than 100 users",
      },
    ];
  }
  if (dataset === "events" || dataset === "errors") {
    return [
      { pattern: "level:error", description: "Error events" },
      { pattern: "environment:production", description: "Production events" },
      { pattern: "timestamp:-1h", description: "Events from last hour" },
      { pattern: "has:http.method", description: "HTTP requests" },
      { pattern: "has:db.statement", description: "Database queries" },
    ];
  }

  return [];
}
