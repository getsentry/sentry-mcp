import type { ReplayDetails, SentryApiService } from "../../api-client";

export const DEFAULT_REPLAY_SORT = "-started_at";
export const DEFAULT_REPLAY_STATS_PERIOD = "14d";

export const REPLAY_SORT_FIELDS = [
  "activity",
  "browser.name",
  "browser.version",
  "count_dead_clicks",
  "count_errors",
  "count_infos",
  "count_rage_clicks",
  "count_urls",
  "count_warnings",
  "device.brand",
  "device.family",
  "device.model",
  "device.name",
  "dist",
  "duration",
  "finished_at",
  "os.name",
  "os.version",
  "platform",
  "project_id",
  "sdk.name",
  "started_at",
  "user.email",
  "user.id",
  "user.username",
] as const;

const replaySortValues = [
  ...REPLAY_SORT_FIELDS,
  ...REPLAY_SORT_FIELDS.map((field) => `-${field}`),
];

const REPLAY_SORT_VALUES = new Set(replaySortValues);

interface ReplayTimeRange {
  statsPeriod?: string;
  start?: string;
  end?: string;
}

export interface FormatReplayResultsParams {
  replays: ReplayDetails[];
  naturalLanguageQuery: string;
  includeExplanation: boolean;
  organizationSlug: string;
  apiService: SentryApiService;
  searchUrl: string;
  replayQuery: string;
  sort: string;
  environment?: string | string[] | null;
  explanation?: string;
  timeRange?: ReplayTimeRange;
}

export function isValidReplaySort(sort: string): boolean {
  return REPLAY_SORT_VALUES.has(sort);
}

export function formatReplayResults(params: FormatReplayResultsParams): string {
  const {
    replays,
    naturalLanguageQuery,
    includeExplanation,
    organizationSlug,
    apiService,
    searchUrl,
    replayQuery,
    sort,
    environment,
    explanation,
    timeRange,
  } = params;

  let output = `# Search Results for "${naturalLanguageQuery}"\n\n`;
  output +=
    "⚠️ **IMPORTANT**: Display these replays as cards or rows with clickable Replay IDs, user context, duration, click/error counts, and page URLs.\n\n";

  if (includeExplanation) {
    output += "## Query Translation\n";
    output += `Natural language: "${naturalLanguageQuery}"\n`;
    output += `Replay query: \`${replayQuery || "(none)"}\`\n`;
    if (environment) {
      output += `Environment: ${formatReplayEnvironment(environment)}\n`;
    }
    output += `Sort: ${sort}\n`;
    output += `Time range: ${formatTimeRange(timeRange)}\n\n`;

    if (explanation) {
      output += `## How I interpreted your query\n\n${explanation}\n\n`;
    }
  }

  output += `**View these results in Sentry**:\n${searchUrl}\n`;
  output +=
    "_Please share this link with the user to view the search results in their Sentry dashboard._\n\n";

  if (replays.length === 0) {
    output += "No replays found matching your search criteria.\n\n";
    output += "Try broadening the query or expanding the time range.";
    return output;
  }

  output += `Found **${replays.length}** replay${replays.length === 1 ? "" : "s"}:\n\n`;

  replays.forEach((replay, index) => {
    const replayUrl = apiService.getReplayUrl(organizationSlug, replay.id);
    const user = formatReplayUser(replay);
    const clickSummary = [
      `${replay.count_errors ?? 0} error${replay.count_errors === 1 ? "" : "s"}`,
      `${replay.count_rage_clicks ?? 0} rage click${replay.count_rage_clicks === 1 ? "" : "s"}`,
      `${replay.count_dead_clicks ?? 0} dead click${replay.count_dead_clicks === 1 ? "" : "s"}`,
    ].join(" · ");

    output += `## ${index + 1}. [${replay.id}](${replayUrl})\n\n`;
    output += `- **Started**: ${formatTimestamp(replay.started_at)}\n`;
    output += `- **Duration**: ${formatDurationSeconds(replay.duration)}\n`;
    output += `- **User**: ${user}\n`;
    output += `- **Summary**: ${clickSummary}\n`;
    output += `- **Environment**: ${replay.environment ?? "Unknown"}\n`;
    output += `- **Browser**: ${formatNameVersion(replay.browser?.name, replay.browser?.version)}\n`;

    if (replay.urls.length > 0) {
      output += `- **Pages**: ${formatReplayUrls(replay.urls)}\n`;
    }
    if (replay.releases && replay.releases.length > 0) {
      output += `- **Release**: ${replay.releases[0]}\n`;
    }
    if (replay.trace_ids.length > 0) {
      output += `- **Trace**: \`${replay.trace_ids[0]}\`${replay.trace_ids.length > 1 ? ` (+${replay.trace_ids.length - 1} more)` : ""}\n`;
    }
    if (replay.is_archived) {
      output += "- **Status**: Archived\n";
    }

    output += "\n";
  });

  output += "## Next Steps\n\n";
  output +=
    "- Inspect a specific replay in more detail: Use `get_replay_details` with the replay ID or replay URL\n";
  output +=
    "- Pivot from a replay into related issues or traces: Open the replay link above, then use `get_sentry_resource` on related issue or trace URLs\n";

  return output;
}

function formatReplayUser(replay: ReplayDetails): string {
  return (
    replay.user?.display_name ??
    replay.user?.email ??
    replay.user?.username ??
    replay.user?.id ??
    "Anonymous User"
  );
}

function formatReplayUrls(urls: string[]): string {
  const preview = urls.slice(0, 2).join(", ");
  if (urls.length <= 2) {
    return preview;
  }
  return `${preview} (+${urls.length - 2} more)`;
}

function formatDurationSeconds(durationSeconds?: number | null): string {
  if (durationSeconds == null) {
    return "Unknown";
  }
  if (durationSeconds < 60) {
    return `${durationSeconds}s`;
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatNameVersion(
  name?: string | null,
  version?: string | null,
): string {
  if (name && version) {
    return `${name} ${version}`;
  }
  return name ?? version ?? "Unknown";
}

function formatTimestamp(value?: string | null): string {
  if (!value) {
    return "Unknown";
  }
  return value.replace("T", " ").replace("Z", " UTC");
}

function formatTimeRange(timeRange?: ReplayTimeRange): string {
  if (!timeRange) {
    return "Last 14 days";
  }
  if (timeRange.statsPeriod) {
    return `Last ${timeRange.statsPeriod}`;
  }
  if (timeRange.start && timeRange.end) {
    return `${formatTimestamp(timeRange.start)} to ${formatTimestamp(timeRange.end)}`;
  }
  return "Last 14 days";
}

function formatReplayEnvironment(environment: string | string[]): string {
  return Array.isArray(environment) ? environment.join(", ") : environment;
}
