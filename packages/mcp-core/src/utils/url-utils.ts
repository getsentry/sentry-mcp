import { isMetricsDataset, type EventsDataset } from "./events-datasets";

/**
 * Determines if a Sentry instance is SaaS or self-hosted based on the host.
 * @param host The Sentry host (e.g., "sentry.io" or "sentry.company.com")
 * @returns true if SaaS instance, false if self-hosted
 */
export function isSentryHost(host: string): boolean {
  return host === "sentry.io" || host.endsWith(".sentry.io");
}

export interface TraceMetricIdentifier {
  name: string;
  type: string;
  unit?: string;
}

export interface TraceMetricsExplorerUrlOptions {
  query: string;
  projectId?: string;
  statsPeriod?: string;
  start?: string;
  end?: string;
  sort?: string;
  aggregateFunctions?: string[];
  groupByFields?: string[];
  traceMetrics?: TraceMetricIdentifier[];
}

function getSentryWebBaseUrl(
  host: string,
  organizationSlug: string,
  path: string,
): string {
  const isSaas = isSentryHost(host);
  const webHost = isSaas ? "sentry.io" : host;
  return isSaas
    ? `https://${organizationSlug}.${webHost}${path}`
    : `https://${host}/organizations/${organizationSlug}${path}`;
}

function normalizeTraceMetric(
  metric: TraceMetricIdentifier | null | undefined,
): TraceMetricIdentifier | null {
  if (!metric?.name || !metric.type) {
    return null;
  }

  return {
    name: metric.name,
    type: metric.type,
    unit: metric.unit && metric.unit !== "-" ? metric.unit : undefined,
  };
}

function extractTraceMetricFromAggregate(
  field: string,
): TraceMetricIdentifier | null {
  const match = field.match(/^[^(]+\((.*)\)$/);
  if (!match) {
    return null;
  }

  const args = match[1]
    .split(",")
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0);

  if (args.length < 4) {
    return null;
  }

  return normalizeTraceMetric({
    name: args[1]!,
    type: args[2]!,
    unit: args[3],
  });
}

function extractTraceMetricFromQuery(
  query: string,
): TraceMetricIdentifier | null {
  const extractValue = (field: string): string | null => {
    const quotedMatch = query.match(new RegExp(`${field}:"([^"]+)"`, "i"));
    if (quotedMatch?.[1]) {
      return quotedMatch[1];
    }

    const unquotedMatch = query.match(new RegExp(`${field}:([^\\s]+)`, "i"));
    return unquotedMatch?.[1] ?? null;
  };

  return normalizeTraceMetric({
    name: extractValue("metric\\.name") ?? "",
    type: extractValue("metric\\.type") ?? "",
    unit: extractValue("metric\\.unit") ?? undefined,
  });
}

function dedupeTraceMetrics(
  metrics: Array<TraceMetricIdentifier | null | undefined>,
): TraceMetricIdentifier[] {
  const deduped = new Map<string, TraceMetricIdentifier>();

  for (const metric of metrics) {
    const normalizedMetric = normalizeTraceMetric(metric);
    if (!normalizedMetric) {
      continue;
    }

    const key = `${normalizedMetric.name}|${normalizedMetric.type}|${normalizedMetric.unit ?? ""}`;
    deduped.set(key, normalizedMetric);
  }

  return [...deduped.values()];
}

function buildMetricQueryState(params: {
  metric: TraceMetricIdentifier;
  query: string;
  mode: "aggregate" | "samples";
  yAxes: string[];
  groupByFields?: string[];
  aggregateSortBys?: Array<{ field: string; kind: "asc" | "desc" }>;
}): string {
  return JSON.stringify({
    metric: params.metric,
    query: params.query,
    aggregateFields: [
      ...params.yAxes.map((yAxis) => ({ yAxes: [yAxis] })),
      ...(params.groupByFields ?? []).map((field) => ({ groupBy: field })),
    ],
    aggregateSortBys: params.aggregateSortBys ?? [],
    mode: params.mode,
  });
}

export function getTraceMetricsExploreUrl(
  host: string,
  organizationSlug: string,
  options: TraceMetricsExplorerUrlOptions,
): string {
  const {
    query,
    projectId,
    statsPeriod,
    start,
    end,
    sort,
    aggregateFunctions,
    groupByFields,
    traceMetrics,
  } = options;

  const urlParams = new URLSearchParams();

  if (projectId) {
    urlParams.set("project", projectId);
  }

  if (start && end) {
    urlParams.set("start", start);
    urlParams.set("end", end);
  } else {
    urlParams.set("statsPeriod", statsPeriod || "24h");
  }

  const aggregateFields = aggregateFunctions ?? [];
  const aggregateGroupByFields = groupByFields ?? [];
  const isAggregateQuery = aggregateFields.length > 0;

  const sortField = sort?.startsWith("-") ? sort.slice(1) : sort;
  const sortKind = sort?.startsWith("-") ? ("desc" as const) : ("asc" as const);

  if (isAggregateQuery) {
    const metricQueries = new Map<
      string,
      {
        metric: TraceMetricIdentifier;
        yAxes: string[];
      }
    >();

    for (const aggregateField of aggregateFields) {
      const metric = extractTraceMetricFromAggregate(aggregateField);
      if (!metric) {
        continue;
      }

      const key = `${metric.name}|${metric.type}|${metric.unit ?? ""}`;
      const existing = metricQueries.get(key);
      if (existing) {
        existing.yAxes.push(aggregateField);
      } else {
        metricQueries.set(key, {
          metric,
          yAxes: [aggregateField],
        });
      }
    }

    for (const { metric, yAxes } of metricQueries.values()) {
      const aggregateSortBys =
        sortField &&
        (yAxes.includes(sortField) ||
          aggregateGroupByFields.includes(sortField))
          ? [{ field: sortField, kind: sortKind }]
          : [];

      urlParams.append(
        "metric",
        buildMetricQueryState({
          metric,
          query,
          mode: "aggregate",
          yAxes,
          groupByFields: aggregateGroupByFields,
          aggregateSortBys,
        }),
      );
    }
  } else {
    const sampleMetrics = dedupeTraceMetrics([
      ...(traceMetrics ?? []),
      extractTraceMetricFromQuery(query),
    ]);

    for (const metric of sampleMetrics) {
      urlParams.append(
        "metric",
        buildMetricQueryState({
          metric,
          query,
          mode: "samples",
          yAxes: ["sum(value)"],
          aggregateSortBys: [{ field: "sum(value)", kind: "desc" }],
        }),
      );
    }
  }

  return `${getSentryWebBaseUrl(host, organizationSlug, "/explore/metrics/")}?${urlParams.toString()}`;
}

/**
 * Generates a Sentry issue URL.
 * @param host The Sentry host (may include regional subdomain for API access)
 * @param organizationSlug Organization identifier
 * @param issueId Issue identifier (e.g., "PROJECT-123")
 * @returns The complete issue URL
 */
export function getIssueUrl(
  host: string,
  organizationSlug: string,
  issueId: string,
): string {
  return getSentryWebBaseUrl(host, organizationSlug, `/issues/${issueId}`);
}

/**
 * Generates a Sentry issues search URL.
 * @param host The Sentry host (may include regional subdomain for API access)
 * @param organizationSlug Organization identifier
 * @param query Optional search query
 * @param projectSlugOrId Optional project slug or ID
 * @returns The complete issues search URL
 */
export function getIssuesSearchUrl(
  host: string,
  organizationSlug: string,
  query?: string | null,
  projectSlugOrId?: string,
): string {
  let url = getSentryWebBaseUrl(host, organizationSlug, "/issues/");

  const params = new URLSearchParams();
  if (projectSlugOrId) {
    params.append("project", projectSlugOrId);
  }
  if (query) {
    params.append("query", query);
  }

  const queryString = params.toString();
  if (queryString) {
    url += `?${queryString}`;
  }

  return url;
}

/**
 * Generates a Sentry trace URL for performance investigation.
 * @param host The Sentry host (may include regional subdomain for API access)
 * @param organizationSlug Organization identifier
 * @param traceId Trace identifier
 * @returns The complete trace URL
 */
export function getTraceUrl(
  host: string,
  organizationSlug: string,
  traceId: string,
): string {
  return getSentryWebBaseUrl(
    host,
    organizationSlug,
    `/explore/traces/trace/${traceId}`,
  );
}

/**
 * Generates a Sentry replay URL.
 * @param host The Sentry host (may include regional subdomain for API access)
 * @param organizationSlug Organization identifier
 * @param replayId Replay identifier
 * @returns The complete replay URL
 */
export function getReplayUrl(
  host: string,
  organizationSlug: string,
  replayId: string,
): string {
  return getSentryWebBaseUrl(host, organizationSlug, `/replays/${replayId}/`);
}

/**
 * Generates a Sentry events explorer URL.
 * @param host The Sentry host (may include regional subdomain for API access)
 * @param organizationSlug Organization identifier
 * @param query Search query
 * @param dataset Dataset type
 * @param projectSlug Optional project slug
 * @param fields Optional fields to display
 * @returns The complete events explorer URL
 */
export function getEventsExplorerUrl(
  host: string,
  organizationSlug: string,
  query: string,
  dataset: EventsDataset = "spans",
  projectSlugOrId?: string,
  fields?: string[],
  traceMetricsOptions?: Omit<
    TraceMetricsExplorerUrlOptions,
    "query" | "projectId"
  >,
): string {
  if (isMetricsDataset(dataset)) {
    const derivedAggregateFunctions =
      traceMetricsOptions?.aggregateFunctions ??
      fields?.filter((field) => field.includes("(") && field.includes(")"));
    const derivedGroupByFields =
      traceMetricsOptions?.groupByFields ??
      fields?.filter((field) => !field.includes("(") && !field.includes(")"));

    return getTraceMetricsExploreUrl(host, organizationSlug, {
      ...traceMetricsOptions,
      query,
      projectId: projectSlugOrId,
      aggregateFunctions: derivedAggregateFunctions,
      groupByFields: derivedGroupByFields,
    });
  }

  let url = getSentryWebBaseUrl(host, organizationSlug, "/explore/");

  const params = new URLSearchParams();
  params.append("query", query);
  params.append("dataset", dataset);
  params.append("layout", "table");

  if (projectSlugOrId) {
    params.append("project", projectSlugOrId);
  }

  if (fields && fields.length > 0) {
    for (const field of fields) {
      params.append("field", field);
    }
  }

  url += `?${params.toString()}`;
  return url;
}

/**
 * Internal validation function that checks if a SENTRY_HOST value contains only hostname (no protocol).
 * Throws an error if validation fails instead of exiting the process.
 *
 * @param host The hostname to validate
 * @throws {Error} If the host contains a protocol
 */
function _validateSentryHostInternal(host: string): void {
  if (host.startsWith("http://") || host.startsWith("https://")) {
    throw new Error(
      "SENTRY_HOST should only contain a hostname (e.g., sentry.example.com). Use SENTRY_URL if you want to provide a full URL.",
    );
  }
}

/**
 * Internal validation function that checks if a SENTRY_URL value is a valid HTTPS URL and extracts the hostname.
 * Throws an error if validation fails instead of exiting the process.
 *
 * @param url The HTTPS URL to validate and parse
 * @returns The extracted hostname from the URL
 * @throws {Error} If the URL is invalid or not HTTPS
 */
function _validateAndParseSentryUrlInternal(url: string): string {
  if (!url.startsWith("https://")) {
    throw new Error(
      "SENTRY_URL must be a full HTTPS URL (e.g., https://sentry.example.com).",
    );
  }

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.host;
  } catch (error) {
    throw new Error(
      "SENTRY_URL must be a valid HTTPS URL (e.g., https://sentry.example.com).",
    );
  }
}

/**
 * Validates that a SENTRY_HOST value contains only hostname (no protocol).
 * Exits the process with error code 1 if validation fails (CLI behavior).
 *
 * @param host The hostname to validate
 */
export function validateSentryHost(host: string): void {
  try {
    _validateSentryHostInternal(host);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Validates that a SENTRY_URL value is a valid HTTPS URL and extracts the hostname.
 * Exits the process with error code 1 if validation fails (CLI behavior).
 *
 * @param url The HTTPS URL to validate and parse
 * @returns The extracted hostname from the URL
 */
export function validateAndParseSentryUrl(url: string): string {
  try {
    return _validateAndParseSentryUrlInternal(url);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Validates that a SENTRY_HOST value contains only hostname (no protocol).
 * Throws an error instead of exiting the process (for testing).
 *
 * @param host The hostname to validate
 * @throws {Error} If the host contains a protocol
 */
export function validateSentryHostThrows(host: string): void {
  _validateSentryHostInternal(host);
}

/**
 * Validates that a SENTRY_URL value is a valid HTTPS URL and extracts the hostname.
 * Throws an error instead of exiting the process (for testing).
 *
 * @param url The HTTPS URL to validate and parse
 * @returns The extracted hostname from the URL
 * @throws {Error} If the URL is invalid or not HTTPS
 */
export function validateAndParseSentryUrlThrows(url: string): string {
  return _validateAndParseSentryUrlInternal(url);
}

/**
 * Validates that the provided OpenAI base URL is a valid HTTP(S) URL and returns a normalized string.
 *
 * @param url The URL to validate and normalize
 * @returns The normalized URL string
 * @throws {Error} If the URL is empty, invalid, or uses an unsupported protocol
 */
export function validateOpenAiBaseUrlThrows(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw new Error("OPENAI base URL must not be empty.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    throw new Error(
      "OPENAI base URL must be a valid HTTP or HTTPS URL (e.g., https://example.com/v1).",
      { cause: error },
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      "OPENAI base URL must use http or https scheme (e.g., https://example.com/v1).",
    );
  }

  // Preserve the exact path to support Azure or proxy endpoints that include version/path segments
  return parsed.toString();
}
