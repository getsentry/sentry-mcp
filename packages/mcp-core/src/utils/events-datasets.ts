export const PUBLIC_EVENTS_DATASETS = [
  "spans",
  "errors",
  "logs",
  "metrics",
] as const;

export type PublicEventsDataset = (typeof PUBLIC_EVENTS_DATASETS)[number];
export type EventsApiDataset = "spans" | "errors" | "logs" | "tracemetrics";
export type EventsDataset = PublicEventsDataset | "tracemetrics";

export function isMetricsDataset(
  dataset: EventsDataset,
): dataset is "metrics" | "tracemetrics" {
  return dataset === "metrics" || dataset === "tracemetrics";
}

/**
 * Sentry's product-facing Explore schemas already call this dataset "metrics",
 * but the current `/events/` and `/trace-items/attributes/` APIs still expect
 * the legacy `tracemetrics` identifier. Keep MCP aligned with the UI-facing
 * schema and swap only at the transport boundary until the upstream API name
 * catches up.
 */
export function normalizeEventsDataset(
  dataset: EventsDataset,
): EventsApiDataset {
  return dataset === "metrics" ? "tracemetrics" : dataset;
}
