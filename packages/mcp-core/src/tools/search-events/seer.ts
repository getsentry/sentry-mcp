import type { z } from "zod";
import type { SentryApiService } from "../../api-client";
import {
  ApiAuthenticationError,
  type SearchAgentQuerySchema,
} from "../../api-client/index";
import { logWarn } from "../../telem/logging";
import {
  normalizeEventsDataset,
  type PublicEventsDataset,
} from "../../utils/events-datasets";
import { RECOMMENDED_FIELDS } from "./config";

export const SEER_SEARCH_AGENT_POLLING_INTERVAL = 1000; // 1 second
export const SEER_SEARCH_AGENT_TIMEOUT = 60 * 1000; // 1 minute

// Organization features the search agent endpoints require. `hideAiFeatures`
// is checked separately.
const REQUIRED_FEATURES = ["gen-ai-features", "gen-ai-search-agent-translate"];

const SEER_STRATEGIES = {
  errors: "Errors",
  logs: "Logs",
  spans: "Traces",
  metrics: "Metrics",
} as const satisfies Partial<Record<PublicEventsDataset, string>>;

export type SeerSearchDataset = keyof typeof SEER_STRATEGIES;

export function isSeerSearchDataset(
  dataset: string | undefined,
): dataset is SeerSearchDataset {
  return dataset !== undefined && dataset in SEER_STRATEGIES;
}

export interface SeerSearchTranslation {
  query: string;
  fields: string[];
  sort: string;
  timeParams: { statsPeriod?: string; start?: string; end?: string };
  explanation: string;
}

async function hasSeerSearchAgentAccess(
  apiService: SentryApiService,
  organizationSlug: string,
): Promise<boolean> {
  const organization = await apiService.getOrganization(organizationSlug);
  if (organization.hideAiFeatures) {
    return false;
  }
  const features = organization.features ?? [];
  return REQUIRED_FEATURES.every((feature) => features.includes(feature));
}

function toSearchTranslation(
  result: z.output<typeof SearchAgentQuerySchema>,
  dataset: SeerSearchDataset,
): SeerSearchTranslation {
  const aggregates = result.visualization.flatMap((chart) => chart.y_axes);
  const fields =
    result.mode === "aggregates"
      ? [...new Set([...result.group_by, ...aggregates])]
      : [];
  if (fields.length === 0) {
    fields.push(...RECOMMENDED_FIELDS[normalizeEventsDataset(dataset)].basic);
  }

  const sort =
    result.sort.trim() ||
    (result.mode === "aggregates" && aggregates[0]
      ? `-${aggregates[0]}`
      : "-timestamp");
  // Sentry requires the sort field to be selected.
  const sortField = sort.startsWith("-") ? sort.slice(1) : sort;
  if (!fields.includes(sortField)) {
    fields.push(sortField);
  }

  let timeParams: SeerSearchTranslation["timeParams"];
  if (result.stats_period) {
    timeParams = { statsPeriod: result.stats_period };
  } else if (result.start && result.end) {
    timeParams = { start: result.start, end: result.end };
  } else {
    timeParams = { statsPeriod: "14d" };
  }

  let explanation = "Translated by Seer's search agent.";
  const crossEventQueries = [
    result.span_query,
    result.log_query,
    result.metric_query,
  ].filter(Boolean);
  if (crossEventQueries.length > 0) {
    explanation += ` Seer also suggested cross-event filters (${crossEventQueries.join(", ")}), which search_events does not apply.`;
  }

  return { query: result.query, fields, sort, timeParams, explanation };
}

/**
 * Translates a natural language query with Seer's search agent.
 *
 * Returns null when Seer is unavailable for the organization, cannot translate
 * the query, or does not finish in time, so the caller can fall back to the
 * embedded agent or direct query syntax.
 */
export async function translateWithSeer({
  apiService,
  organizationSlug,
  projectId,
  dataset,
  query,
}: {
  apiService: SentryApiService;
  organizationSlug: string;
  projectId: string;
  dataset: SeerSearchDataset;
  query: string;
}): Promise<SeerSearchTranslation | null> {
  try {
    if (!(await hasSeerSearchAgentAccess(apiService, organizationSlug))) {
      return null;
    }

    const run = await apiService.startSearchAgent({
      organizationSlug,
      projectIds: [Number(projectId)],
      naturalLanguageQuery: query,
      strategy: SEER_STRATEGIES[dataset],
    });

    const deadline = Date.now() + SEER_SEARCH_AGENT_TIMEOUT;
    while (Date.now() < deadline) {
      const { session } = await apiService.getSearchAgentState({
        organizationSlug,
        runId: run.sentry_run_id,
      });

      if (session?.status === "completed") {
        const result = session.final_response?.responses[0];
        return result ? toSearchTranslation(result, dataset) : null;
      }
      if (session?.status === "error") {
        return null;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, SEER_SEARCH_AGENT_POLLING_INTERVAL),
      );
    }

    logWarn("Seer search agent timed out", {
      extra: { organizationSlug, runId: run.sentry_run_id },
    });
    return null;
  } catch (error) {
    // An invalid token should surface to the user rather than fall back.
    if (error instanceof ApiAuthenticationError) {
      throw error;
    }
    logWarn(error, { extra: { organizationSlug } });
    return null;
  }
}
