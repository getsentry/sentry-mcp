/**
 * Chart data types and utilities for MCP Apps visualization.
 */

/**
 * Suggested chart type for visualization
 */
export type ChartType = "bar" | "pie" | "line" | "table" | "number";

/**
 * Chart data structure passed from the server to the UI
 */
export interface ChartData {
  /** Suggested chart type for visualization */
  chartType: ChartType;
  /** Raw data from the search query */
  data: Record<string, unknown>[];
  /** Fields used for grouping (labels/x-axis) */
  labels: string[];
  /** Fields containing aggregate values (y-axis) */
  values: string[];
  /** Original natural language query for context */
  query: string;
}

/**
 * Infer the best chart type based on the data structure
 */
export function inferChartType(
  data: Record<string, unknown>[],
  labels: string[],
  values: string[],
): ChartType {
  // Single value = number display
  if (data.length === 1 && labels.length === 0 && values.length === 1) {
    return "number";
  }

  // Check if labels look like time-based
  const firstLabel = labels[0];
  const isTimeBased =
    firstLabel?.toLowerCase().includes("time") ||
    firstLabel?.toLowerCase().includes("date") ||
    firstLabel?.toLowerCase().includes("day") ||
    firstLabel?.toLowerCase().includes("hour");

  if (isTimeBased) {
    return "line";
  }

  // Multiple values or many categories = table might be better
  if (values.length > 2 || data.length > 10) {
    return "table";
  }

  // Single category with counts = pie chart works well
  if (labels.length === 1 && values.length === 1 && data.length <= 7) {
    return "pie";
  }

  // Default to bar chart
  return "bar";
}
