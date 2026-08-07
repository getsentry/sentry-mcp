/**
 * Shared infrastructure for org-scoped list commands (team, repo, project, issue, …).
 *
 * ## Config types
 *
 * Commands that rely entirely on default handlers supply a full {@link OrgListConfig}.
 * Commands that override every mode only need {@link ListCommandMeta} (metadata used
 * for error messages and cursor keys).
 *
 * ## Dispatch
 *
 * {@link dispatchOrgScopedList} merges a map of default handlers with caller-supplied
 * {@link ModeOverrides} using `{ ...defaults, ...overrides }`, then calls the handler
 * for the current parsed target type. This lets any command replace exactly the modes
 * it needs to customise while inheriting the rest.
 *
 * ## Default handler behaviour
 *
 * | Mode           | Default behaviour                                                        |
 * |----------------|--------------------------------------------------------------------------|
 * | auto-detect    | Resolve orgs from DSN/config; fetch from all, return items               |
 * | explicit       | If `listForProject` provided, use project-scoped fetch; else org-scoped  |
 * | project-search | Find project via `findProjectsBySlug`; use project or org-scoped fetch   |
 * | org-all        | Cursor-paginated single-org listing                                      |
 *
 * ## Data flow
 *
 * All handlers return a {@link ListResult} containing items and rendering metadata.
 * The caller (typically {@link buildOrgListCommand} in `list-command.ts`) decides
 * how to render the result — JSON envelope, human table, or custom formatting.
 */

import {
  API_MAX_PER_PAGE,
  findProjectsBySlug,
  listOrganizations,
  type PaginatedResponse,
} from "./api-client.js";
import type { ParsedOrgProject } from "./arg-parsing.js";
import {
  advancePaginationState,
  buildOrgContextKey,
  type CursorDirection,
  hasPreviousPage,
  resolveCursor,
} from "./db/pagination.js";
import {
  type AuthGuardSuccess,
  ResolutionError,
  ValidationError,
  withAuthGuard,
} from "./errors.js";
import { filterFields } from "./formatters/json.js";
import { paginationHint } from "./list-command.js";
import { logger } from "./logger.js";
import { withProgress } from "./polling.js";
import { resolveEffectiveOrg } from "./region.js";
import {
  type ProjectNotFoundOutcome,
  resolveOrgsForListing,
  triageProjectNotFound,
} from "./resolve-target.js";
import { setOrgProjectContext } from "./telemetry.js";

const log = logger.withTag("org-list");

/**
 * Return type for all org-scoped list handlers.
 *
 * Contains the items plus metadata for rendering (human formatter)
 * and JSON serialization (jsonTransform). The caller decides how to
 * render — handlers never write to stdout directly.
 *
 * @template T - The item type (typically `TWithOrg` with org context)
 */
export type ListResult<T> = {
  /** The items to display */
  items: T[];
  /** Whether more pages are available */
  hasMore?: boolean;
  /** Whether a previous page exists (for bidirectional hint generation) */
  hasPrev?: boolean;
  /** Cursor for fetching the next page (only in paginated modes) */
  nextCursor?: string | null;
  /** Human-readable hint lines (tips, warnings, notes). Suppressed in JSON mode. */
  hint?: string;
  /** Header/title text shown above the table in human mode */
  header?: string;
  /** Fetch errors from partial failures (included in JSON output as `errors` key) */
  errors?: unknown[];
  /** Extra metadata to include in the JSON envelope */
  jsonExtra?: Record<string, unknown>;
};

/**
 * Transform a {@link ListResult} into the standard JSON output format.
 *
 * Paginated responses produce a `{ data, hasMore, nextCursor?, errors?, ... }` envelope.
 * Non-paginated responses produce a flat `[...]` array.
 * Field filtering is applied per-element inside `data`, not to the wrapper.
 *
 * This is the canonical implementation used by all list commands — callers
 * should not duplicate this logic.
 */
export function jsonTransformListResult<T>(
  result: ListResult<T>,
  fields?: string[]
): unknown {
  const items =
    fields && fields.length > 0
      ? result.items.map((item) => filterFields(item, fields))
      : result.items;

  // Paginated mode: wrap in envelope
  if (result.hasMore !== undefined) {
    const envelope: Record<string, unknown> = {
      data: items,
      hasMore: result.hasMore,
    };
    if (
      result.nextCursor !== null &&
      result.nextCursor !== undefined &&
      result.nextCursor !== ""
    ) {
      envelope.nextCursor = result.nextCursor;
    }
    envelope.hasPrev = !!result.hasPrev;
    if (result.errors && result.errors.length > 0) {
      envelope.errors = result.errors;
    }
    if (result.jsonExtra) {
      Object.assign(envelope, result.jsonExtra);
    }
    return envelope;
  }

  // Non-paginated: flat array
  return items;
}

/**
 * Per-target (or per-org) fetch result for budget-aware list commands.
 *
 * Wraps a success value or a captured error so that `fetchWithBudget`
 * can run all fetches in parallel and report partial failures via
 * `logger.warn` instead of throwing.
 *
 * @template T - The success payload type (e.g. `AlertRuleListFetchResult`)
 */
export type FetchResult<T> =
  | { success: true; data: T }
  | { success: false; error: Error };

/**
 * Distribute a global fetch budget across groups in deterministic order.
 *
 * By default, the returned quotas sum exactly to `limit`. When
 * `minimumPerGroup` is true, every group receives at least one slot, so the
 * sum can exceed `limit` if there are more groups than display slots. Use that
 * mode only for first-page fan-out where display trimming can suppress unsafe
 * cursor pagination.
 */
export function distributeFetchBudget(
  limit: number,
  groupCount: number,
  options: { minimumPerGroup?: boolean } = {}
): number[] {
  if (groupCount <= 0) {
    return [];
  }

  const total = Math.max(0, Math.floor(limit));
  const base = Math.floor(total / groupCount);
  const remainder = total % groupCount;
  const minimum = options.minimumPerGroup ? 1 : 0;

  return Array.from({ length: groupCount }, (_, i) =>
    Math.max(minimum, base + (i < remainder ? 1 : 0))
  );
}

/**
 * Trim an array to `limit` entries while guaranteeing at least one entry
 * per group (when possible).
 *
 * Algorithm:
 * 1. Walk the list, picking the first entry from each unseen group key until
 *    `limit` slots are filled or all groups are represented.
 * 2. Fill remaining slots from the top of the list, skipping already-selected
 *    entries.
 * 3. Return the final set in original order.
 *
 * When there are more groups than the limit, groups whose first entry ranks
 * highest in the input order get representation.
 *
 * @param rows - Input array (order is preserved in output)
 * @param limit - Maximum number of entries to return
 * @param getGroupKey - Returns the group key for an entry (e.g. "org/project")
 * @returns Trimmed array in the same order as the input
 */
export function trimWithGroupGuarantee<T>(
  rows: T[],
  limit: number,
  getGroupKey: (row: T) => string
): T[] {
  if (rows.length <= limit) {
    return rows;
  }

  const seenGroups = new Set<string>();
  const guaranteed = new Set<number>();

  // Pass 1: pick one representative per group from the list
  for (let i = 0; i < rows.length && guaranteed.size < limit; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i is within bounds
    const key = getGroupKey(rows[i]!);
    if (!seenGroups.has(key)) {
      seenGroups.add(key);
      guaranteed.add(i);
    }
  }

  // Pass 2: fill remaining budget from the top of the list
  const selected = new Set<number>(guaranteed);
  for (let i = 0; i < rows.length && selected.size < limit; i++) {
    selected.add(i);
  }

  return rows.filter((_, i) => selected.has(i));
}

/**
 * Metadata required by all list commands.
 *
 * Commands that override every dispatch mode can provide just this — the
 * metadata is used for cursor storage keys, error messages, and usage hints.
 */
export type ListCommandMeta = {
  /** Key stored in the pagination cursor table (e.g., "team-list") */
  paginationKey: string;
  /** Singular entity name for messages (e.g., "team") */
  entityName: string;
  /** Plural entity name for messages (e.g., "teams") */
  entityPlural: string;
  /** CLI command prefix for hints (e.g., "sentry team list") */
  commandPrefix: string;
};

/** Minimal flags required by the shared infrastructure. */
export type BaseListFlags = {
  readonly limit: number;
  readonly json: boolean;
  readonly cursor?: string;
  /** Pre-parsed field paths from `--fields` (injected by `buildCommand`). */
  readonly fields?: string[];
};

/**
 * Full configuration for an org-scoped list command using default handlers.
 *
 * @template TEntity   Raw entity type from the API (e.g., SentryTeam)
 * @template TWithOrg  Entity with orgSlug attached for display
 */
export type OrgListConfig<TEntity, TWithOrg> = ListCommandMeta & {
  /**
   * Fetch all entities for one org (non-paginated).
   * @returns Raw entities from the API
   */
  listForOrg: (orgSlug: string) => Promise<TEntity[]>;

  /**
   * Fetch one page of entities for an org (paginated).
   * @returns Paginated response with cursor info
   */
  listPaginated: (
    orgSlug: string,
    opts: { cursor?: string; perPage: number }
  ) => Promise<PaginatedResponse<TEntity[]>>;

  /**
   * Attach org context to a raw entity for display.
   * Typically `{ ...entity, orgSlug }`.
   */
  withOrg: (entity: TEntity, orgSlug: string) => TWithOrg;

  /**
   * Render a list of entities as a formatted table string.
   * Called by the human output path in `buildOrgListCommand`.
   */
  displayTable: (items: TWithOrg[]) => string;

  /**
   * Fetch entities scoped to a specific project (optional).
   *
   * When provided:
   * - `explicit` mode (`org/project`) fetches project-scoped entities instead
   *   of all entities in the org.
   * - `project-search` mode fetches project-scoped entities after finding the
   *   project via cross-org search.
   *
   * When absent:
   * - `explicit` mode falls back to org-scoped listing with a note that the
   *   entity type is org-scoped and the project part is ignored.
   * - `project-search` mode falls back to org-scoped listing from the found
   *   project's parent org.
   */
  listForProject?: (orgSlug: string, projectSlug: string) => Promise<TEntity[]>;

  /**
   * Zod schema describing the JSON output shape of each list item.
   * Forwarded to `OutputConfig.schema` by `buildOrgListCommand` so
   * `--help`, `sentry help`, and SKILL.md can document available fields.
   */
  schema?: import("zod").ZodType;
};

/** Extract a specific variant from the {@link ParsedOrgProject} union by its `type` discriminant. */
export type ParsedVariant<T extends ParsedOrgProject["type"]> = Extract<
  ParsedOrgProject,
  { type: T }
>;

/**
 * Context object passed to every mode handler by the dispatcher.
 *
 * Contains the correctly-narrowed parsed variant plus shared I/O and flags,
 * so handlers don't need to close over these values from their parent scope.
 * Commands that need additional fields (e.g. `stderr`) can
 * spread the context and add their own: `(ctx) => handle({ ...ctx, extra })`.
 */
export type HandlerContext<
  T extends ParsedOrgProject["type"] = ParsedOrgProject["type"],
> = {
  /** Correctly-narrowed parsed target for this mode. */
  parsed: ParsedVariant<T>;
  /** Current working directory (for DSN auto-detection). */
  cwd: string;
  /** Shared list command flags (limit, json, cursor). */
  flags: BaseListFlags;
};

/**
 * A dispatch handler that receives a {@link HandlerContext} with the
 * correctly-narrowed parsed variant for its mode.
 *
 * Returns a {@link ListResult} containing items and rendering metadata.
 * The dispatcher guarantees `ctx.parsed.type` matches the handler key, so
 * callers can safely access variant-specific fields (e.g. `.org`, `.projectSlug`)
 * without runtime checks or manual casts.
 */
export type ModeHandler<
  T extends ParsedOrgProject["type"] = ParsedOrgProject["type"],
  TItem = unknown,
> = (ctx: HandlerContext<T>) => Promise<ListResult<TItem>>;

/**
 * Complete handler map — one handler per parsed target type.
 * Each handler receives a {@link HandlerContext} with the corresponding
 * {@link ParsedVariant} and returns a {@link ListResult}.
 */
export type ModeHandlerMap = {
  // biome-ignore lint/suspicious/noExplicitAny: item type varies per command; erased at dispatch
  [K in ParsedOrgProject["type"]]: ModeHandler<K, any>;
};

/**
 * Partial handler map for overriding specific dispatch modes.
 *
 * Provide only the modes you need to customise; the rest will use
 * the default handlers from {@link buildDefaultHandlers}.
 */
export type ModeOverrides = {
  // biome-ignore lint/suspicious/noExplicitAny: item type varies per command; erased at dispatch
  [K in ParsedOrgProject["type"]]?: ModeHandler<K, any>;
};

/**
 * Narrows `ListCommandMeta | OrgListConfig` to a full `OrgListConfig`.
 * Checks for the presence of `listForOrg` which only the full config has.
 */
export function isOrgListConfig<TEntity, TWithOrg>(
  config: ListCommandMeta | OrgListConfig<TEntity, TWithOrg>
): config is OrgListConfig<TEntity, TWithOrg> {
  return "listForOrg" in config;
}

/**
 * Fetch entities for a single org, returning empty array on non-auth errors.
 * Auth errors propagate so the user sees "please log in".
 */
export async function fetchOrgSafe<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>,
  orgSlug: string
): Promise<TWithOrg[]> {
  const result = await withAuthGuard(async () => {
    const items = await config.listForOrg(orgSlug);
    return items.map((item) => config.withOrg(item, orgSlug));
  });
  return result.ok ? result.value : [];
}

/**
 * Fetch entities from all accessible organisations.
 * Skips orgs where the user lacks access (non-auth errors are swallowed).
 */
export async function fetchAllOrgs<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>
): Promise<TWithOrg[]> {
  const orgs = await listOrganizations();
  const results = await Promise.all(
    orgs.map((org) => fetchOrgSafe(config, org.slug))
  );
  return results.flat();
}

/** Options for {@link handleOrgAll}. */
type OrgAllOptions<TEntity, TWithOrg> = {
  config: OrgListConfig<TEntity, TWithOrg>;
  org: string;
  flags: BaseListFlags;
  contextKey: string;
  cursor: string | undefined;
  direction: CursorDirection;
};

/**
 * Run org-all mode for a given org slug.
 *
 * Convenience wrapper around {@link handleOrgAll} used by the project-search
 * fallback when a bare slug turns out to be an organization. Starts a fresh
 * listing (no cursor) for the org.
 */
function runOrgAll<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>,
  org: string,
  flags: BaseListFlags
): Promise<ListResult<TWithOrg>> {
  const contextKey = buildOrgContextKey(org);
  return handleOrgAll({
    config,
    org,
    flags,
    contextKey,
    cursor: undefined,
    direction: "first",
  });
}

/**
 * Handle org-all mode: cursor-paginated listing for a single org.
 *
 * Returns a {@link ListResult} with items, pagination state, and human hints.
 * Cursor side effects (advancePaginationState/clearPaginationState) are performed
 * inside the handler so callers don't need to manage them.
 */
export async function handleOrgAll<TEntity, TWithOrg>(
  options: OrgAllOptions<TEntity, TWithOrg>
): Promise<ListResult<TWithOrg>> {
  const { config, org, flags, contextKey, cursor, direction } = options;

  const response = await withProgress(
    {
      message: `Fetching ${config.entityPlural} (up to ${flags.limit})...`,
      json: flags.json,
    },
    () =>
      config.listPaginated(org, {
        cursor,
        perPage: Math.min(flags.limit, API_MAX_PER_PAGE),
      })
  );

  const { data: rawItems, nextCursor } = response;
  const items = rawItems.map((entity) => config.withOrg(entity, org));
  const hasMore = !!nextCursor;

  advancePaginationState(
    config.paginationKey,
    contextKey,
    direction,
    nextCursor ?? undefined
  );
  const hasPrev = hasPreviousPage(config.paginationKey, contextKey);

  // Empty results use hint (rendered by human formatter directly).
  // Non-empty results use header (rendered inline after the table).
  let hint: string | undefined;
  let header: string | undefined;

  const base = `${config.commandPrefix} ${org}/`;
  const navHint = paginationHint({
    hasPrev,
    hasMore,
    prevHint: `${base} -c prev`,
    nextHint: `${base} -c next`,
  });

  if (items.length === 0) {
    if (navHint) {
      hint = `No ${config.entityPlural} on this page. ${navHint}`;
    } else {
      hint = `No ${config.entityPlural} found in organization '${org}'.`;
    }
  } else if (hasMore) {
    header = `Showing ${items.length} ${config.entityPlural} (more available)\n${navHint}`;
  } else if (navHint) {
    // Last page but previous pages exist — show count + nav hint without "more available"
    header = `Showing ${items.length} ${config.entityPlural}\n${navHint}`;
  } else {
    header = `Showing ${items.length} ${config.entityPlural}`;
  }

  return {
    items,
    hasMore,
    hasPrev,
    nextCursor: nextCursor ?? null,
    hint,
    header,
  };
}

/**
 * Handle auto-detect mode: resolve orgs from config/DSN, fetch all entities.
 *
 * Returns a {@link ListResult} with the merged items from all resolved orgs.
 */
export async function handleAutoDetect<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>,
  cwd: string,
  flags: BaseListFlags
): Promise<ListResult<TWithOrg>> {
  const {
    orgs: orgsToFetch,
    footer,
    skippedSelfHosted,
  } = await resolveOrgsForListing(undefined, cwd);

  const allItems = await withProgress(
    {
      message: `Fetching ${config.entityPlural} (up to ${flags.limit})...`,
      json: flags.json,
    },
    async () => {
      if (orgsToFetch.length > 0) {
        const results = await Promise.all(
          orgsToFetch.map((org) => fetchOrgSafe(config, org))
        );
        return results.flat();
      }
      return fetchAllOrgs(config);
    }
  );

  const limitCount =
    orgsToFetch.length > 1 ? flags.limit * orgsToFetch.length : flags.limit;
  const limited = allItems.slice(0, limitCount);

  const hintParts: string[] = [];

  if (limited.length === 0) {
    const msg =
      orgsToFetch.length === 1
        ? `No ${config.entityPlural} found in organization '${orgsToFetch[0]}'.`
        : `No ${config.entityPlural} found.`;
    hintParts.push(msg);
  }

  if (allItems.length > limited.length) {
    hintParts.push(
      `Showing ${limited.length} of ${allItems.length} ${config.entityPlural}`
    );
  }

  if (footer) {
    hintParts.push(footer);
  }

  if (skippedSelfHosted) {
    hintParts.push(
      `Note: ${skippedSelfHosted} DSN(s) could not be resolved. ` +
        `Specify the organization explicitly: ${config.commandPrefix} <org>/`
    );
  }

  if (limited.length > 0) {
    hintParts.push(
      `Tip: Use '${config.commandPrefix} <org>/' to filter by organization`
    );
  }

  return {
    items: limited,
    hint: hintParts.length > 0 ? hintParts.join("\n") : undefined,
  };
}

/** Options for {@link buildFetchedItemsResult}. */
type FetchedItemsOptions<TEntity, TWithOrg> = {
  config: OrgListConfig<TEntity, TWithOrg>;
  items: TWithOrg[];
  flags: BaseListFlags;
  /** Human-readable context for "No X found in <label>" messages. */
  contextLabel: string;
  /**
   * Raw org slug for the pagination hint command (e.g. "my-org").
   * When provided and results are truncated, emits a hint like
   * `sentry team list my-org/ for paginated results`.
   */
  orgSlugForHint?: string;
};

/**
 * Build a {@link ListResult} for entities fetched for a single org or project scope.
 * Shared by handleExplicitOrg and handleExplicitProject.
 */
function buildFetchedItemsResult<TEntity, TWithOrg>(
  opts: FetchedItemsOptions<TEntity, TWithOrg>
): ListResult<TWithOrg> {
  const { config, items, flags, contextLabel, orgSlugForHint } = opts;
  const limited = items.slice(0, flags.limit);

  if (limited.length === 0) {
    return {
      items: [],
      hint: `No ${config.entityPlural} found in ${contextLabel}.`,
    };
  }

  const hintParts: string[] = [];
  if (items.length > limited.length) {
    const paginateTip = orgSlugForHint
      ? ` Use '${config.commandPrefix} ${orgSlugForHint}/' for paginated results.`
      : "";
    hintParts.push(
      `Showing ${limited.length} of ${items.length} ${config.entityPlural}.${paginateTip}`
    );
  } else {
    hintParts.push(`Showing ${limited.length} ${config.entityPlural}`);
  }

  return {
    items: limited,
    hint: hintParts.join("\n"),
  };
}

/** Options for {@link handleExplicitOrg}. */
type ExplicitOrgOptions<TEntity, TWithOrg> = {
  config: OrgListConfig<TEntity, TWithOrg>;
  org: string;
  flags: BaseListFlags;
  /** When true, include a note that the entity type is org-scoped. */
  noteOrgScoped?: boolean;
};

/**
 * Handle a single explicit org (non-paginated fetch).
 *
 * When the config has no `listForProject`, this is also the fallback for
 * explicit `org/project` mode — a note is included to inform the user
 * that the entity type is org-scoped.
 *
 * Returns a {@link ListResult} with items and contextual hints.
 */
export async function handleExplicitOrg<TEntity, TWithOrg>(
  options: ExplicitOrgOptions<TEntity, TWithOrg>
): Promise<ListResult<TWithOrg>> {
  const { config, org, flags, noteOrgScoped = false } = options;
  const items = await withProgress(
    {
      message: `Fetching ${config.entityPlural} (up to ${flags.limit})...`,
      json: flags.json,
    },
    () => fetchOrgSafe(config, org)
  );

  const result = buildFetchedItemsResult({
    config,
    items,
    flags,
    contextLabel: `organization '${org}'`,
  });

  // Org-scoped note goes in header so it renders as plain text (not muted).
  if (noteOrgScoped) {
    const note = `Note: ${config.entityPlural} are org-scoped. Showing all ${config.entityPlural} in '${org}'.`;
    result.header = result.header ? `${note}\n${result.header}` : note;
  }

  if (items.length > 0) {
    const tip = `Tip: Use '${config.commandPrefix} ${org}/' for paginated results`;
    result.hint = result.hint ? `${result.hint}\n${tip}` : tip;
  }

  return result;
}

/** Options for {@link handleExplicitProject}. */
type ExplicitProjectOptions<TEntity, TWithOrg> = {
  config: OrgListConfig<TEntity, TWithOrg>;
  org: string;
  project: string;
  flags: BaseListFlags;
};

/**
 * Handle explicit `org/project` mode when `listForProject` is available.
 * Fetches entities scoped to the specific project.
 *
 * `config.listForProject` must be defined — callers must guard before calling.
 *
 * Returns a {@link ListResult} with items and hint text.
 */
export async function handleExplicitProject<TEntity, TWithOrg>(
  options: ExplicitProjectOptions<TEntity, TWithOrg>
): Promise<ListResult<TWithOrg>> {
  const { config, org, project, flags } = options;
  const listForProject = config.listForProject;
  if (!listForProject) {
    throw new Error(
      "handleExplicitProject called but config.listForProject is not defined"
    );
  }
  const raw = await withProgress(
    {
      message: `Fetching ${config.entityPlural} (up to ${flags.limit})...`,
      json: flags.json,
    },
    () => listForProject(org, project)
  );
  const items = raw.map((entity) => config.withOrg(entity, org));

  const result = buildFetchedItemsResult({
    config,
    items,
    flags,
    contextLabel: `project '${org}/${project}'`,
  });

  if (items.length > 0) {
    const tip = `Tip: Use '${config.commandPrefix} ${org}/' to see all ${config.entityPlural} in the org`;
    result.hint = result.hint ? `${result.hint}\n${tip}` : tip;
  }

  return result;
}

/**
 * Handle project-search mode (bare slug, e.g., "cli").
 *
 * Searches for a project matching the slug across all accessible orgs via
 * `findProjectsBySlug`. This gives consistent UX with `project list` and
 * `issue list` where a bare slug is always treated as a project slug, not
 * an org slug.
 *
 * If `config.listForProject` is available, fetches entities scoped to each
 * matched project. Otherwise fetches org-scoped entities from the matched
 * project's parent org (since the entity type is org-scoped).
 *
 * @param orgAllFallback - Optional callback invoked when the slug matches
 *   an organization instead of a project. Receives the org slug and should
 *   delegate to the org-all handler. When not provided, a helpful error is
 *   thrown instead.
 *
 * Returns a {@link ListResult} with items and hint text.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-mode dispatch with recovery is inherently branchy
export async function handleProjectSearch<TEntity, TWithOrg>(
  config: OrgListConfig<TEntity, TWithOrg>,
  projectSlug: string,
  options: {
    flags: BaseListFlags;
    orgAllFallback?: (orgSlug: string) => Promise<ListResult<TWithOrg>>;
    /** Original user input before normalization — for clearer messages. */
    originalSlug?: string;
    /** Organization slug to scope the search to (e.g. from "org/My Project"). */
    org?: string;
  },
  /** Guard against infinite recursion from fuzzy recovery. */
  _isRecoveryAttempt = false
): Promise<ListResult<TWithOrg>> {
  const { flags, orgAllFallback, originalSlug, org: scopedOrg } = options;
  /** Display label: the user's raw input when available, otherwise the slug. */
  const displaySlug = originalSlug ?? projectSlug;
  // When the input is a display name (originalSlug set, contains spaces),
  // skip the slug-based API lookup and go straight to name-based matching.
  const isDisplayName = originalSlug !== undefined;
  const { projects: rawMatches, orgs: foundOrgs } = isDisplayName
    ? { projects: [], orgs: await listOrganizations() }
    : await withProgress(
        {
          message: `Fetching ${config.entityPlural} (up to ${flags.limit})...`,
          json: flags.json,
        },
        () => findProjectsBySlug(projectSlug)
      );

  // When the caller provided an org (e.g. "org/My Project"), scope the
  // search to that org instead of all accessible orgs. This applies to both
  // display-name searches and slug-based recovery lookups. The slug-based
  // lookup (findProjectsBySlug) fans out across every accessible org, so the
  // matched projects must be filtered too — otherwise a recovered slug that
  // also exists in a different org could leak into a scoped result.
  const orgs =
    scopedOrg !== undefined
      ? foundOrgs.filter((o) => o.slug === scopedOrg)
      : foundOrgs;
  const matches =
    scopedOrg !== undefined
      ? rawMatches.filter((m) => m.orgSlug === scopedOrg)
      : rawMatches;

  if (matches.length === 0) {
    // Skip triage on recovery attempts to prevent infinite recursion.
    const outcome: ProjectNotFoundOutcome = _isRecoveryAttempt
      ? { kind: "not-found", displaySlug, suggestions: [] }
      : await triageProjectNotFound(projectSlug, orgs, originalSlug);

    if (outcome.kind === "org-match") {
      if (orgAllFallback) {
        log.warn(
          `'${projectSlug}' is an organization, not a project. ` +
            `Listing all ${config.entityPlural} in '${projectSlug}'.`
        );
        return orgAllFallback(projectSlug);
      }
      throw new ResolutionError(
        `'${projectSlug}'`,
        "is an organization, not a project",
        `${config.commandPrefix} ${projectSlug}/`,
        [
          `List projects: sentry project list ${projectSlug}/`,
          `Specify a project: ${config.commandPrefix} ${projectSlug}/<project>`,
        ]
      );
    }

    if (outcome.kind === "fuzzy-match") {
      // Don't pass originalSlug on the recovery call — the recovered slug
      // is a real slug that should go through the normal slug-based lookup.
      return handleProjectSearch(
        config,
        outcome.project,
        { ...options, originalSlug: undefined },
        true
      );
    }

    if (flags.json) {
      return { items: [] };
    }

    const fallback = scopedOrg
      ? [
          `No project with this name found in organization '${scopedOrg}'`,
          `Check the organization slug or try: sentry project list ${scopedOrg}/`,
        ]
      : ["No project with this slug found in any accessible organization"];
    throw new ResolutionError(
      `Project '${displaySlug}'`,
      "not found",
      `${config.commandPrefix} <org>/${projectSlug}`,
      outcome.suggestions.length > 0 ? outcome.suggestions : fallback
    );
  }

  let allItems: TWithOrg[];

  if (config.listForProject) {
    const listForProject = config.listForProject;
    const results = await Promise.all(
      matches.map((m) =>
        withAuthGuard(async () => {
          const raw = await listForProject(m.orgSlug, m.slug);
          return raw.map((entity) => config.withOrg(entity, m.orgSlug));
        })
      )
    );
    allItems = results
      .filter((r): r is AuthGuardSuccess<TWithOrg[]> => r.ok)
      .flatMap((r) => r.value);
  } else {
    const uniqueOrgs = [...new Set(matches.map((m) => m.orgSlug))];
    const results = await Promise.all(
      uniqueOrgs.map((org) => fetchOrgSafe(config, org))
    );
    allItems = results.flat();
  }

  const limited = allItems.slice(0, flags.limit);

  if (limited.length === 0) {
    return {
      items: [],
      hint: `No ${config.entityPlural} found for project '${projectSlug}'.`,
    };
  }

  const hintParts: string[] = [];
  if (allItems.length > limited.length) {
    hintParts.push(
      `Showing ${limited.length} of ${allItems.length} ${config.entityPlural}. Use --limit to show more.`
    );
  } else {
    hintParts.push(`Showing ${limited.length} ${config.entityPlural}`);
  }

  if (matches.length > 1) {
    hintParts.push(`Found '${projectSlug}' in ${matches.length} organizations`);
  }

  return {
    items: limited,
    hint: hintParts.join("\n"),
  };
}

/**
 * Build the default `ModeHandlerMap` for the given config.
 *
 * Each handler receives a {@link HandlerContext} with the correctly-narrowed
 * parsed variant, so it can access variant-specific fields without casts.
 *
 * If `config` is only {@link ListCommandMeta} (not a full {@link OrgListConfig}),
 * each default handler throws when invoked — this only happens if a mode is not
 * covered by the caller's overrides, which would be a programming error.
 */
function buildDefaultHandlers<TEntity, TWithOrg>(
  config: ListCommandMeta | OrgListConfig<TEntity, TWithOrg>
): ModeHandlerMap {
  function notSupported<T extends ParsedOrgProject["type"]>(
    mode: string
  ): ModeHandler<T> {
    return () =>
      Promise.reject(
        new Error(
          `No handler for '${mode}' mode in '${config.commandPrefix}'. ` +
            "Provide a full OrgListConfig or an override for this mode."
        )
      );
  }

  if (!isOrgListConfig(config)) {
    return {
      "auto-detect": notSupported("auto-detect"),
      explicit: notSupported("explicit"),
      "project-search": notSupported("project-search"),
      "org-all": notSupported("org-all"),
    };
  }

  return {
    "auto-detect": (ctx) => handleAutoDetect(config, ctx.cwd, ctx.flags),

    explicit: (ctx) => {
      if (config.listForProject) {
        return handleExplicitProject({
          config,
          org: ctx.parsed.org,
          project: ctx.parsed.project,
          flags: ctx.flags,
        });
      }
      return handleExplicitOrg({
        config,
        org: ctx.parsed.org,
        flags: ctx.flags,
        noteOrgScoped: true,
      });
    },

    "project-search": (ctx) =>
      handleProjectSearch(config, ctx.parsed.projectSlug, {
        flags: ctx.flags,
        orgAllFallback: (orgSlug) => runOrgAll(config, orgSlug, ctx.flags),
        originalSlug: ctx.parsed.originalSlug,
        org: ctx.parsed.org,
      }),

    "org-all": (ctx) => {
      const contextKey = buildOrgContextKey(ctx.parsed.org);
      const { cursor, direction } = resolveCursor(
        ctx.flags.cursor,
        config.paginationKey,
        contextKey
      );
      return handleOrgAll({
        config,
        org: ctx.parsed.org,
        flags: ctx.flags,
        contextKey,
        cursor,
        direction,
      });
    },
  };
}

/** Options for {@link dispatchOrgScopedList}. */
export type DispatchOptions<TEntity = unknown, TWithOrg = unknown> = {
  /** Full config (for default handlers) or just metadata (all modes overridden). */
  config: ListCommandMeta | OrgListConfig<TEntity, TWithOrg>;
  cwd: string;
  flags: BaseListFlags;
  parsed: ParsedOrgProject;
  /**
   * Per-mode handler overrides. Each key matches a `ParsedOrgProject["type"]`.
   * Provided handlers replace the corresponding default handler; unspecified
   * modes fall back to the defaults from {@link buildDefaultHandlers}.
   */
  overrides?: ModeOverrides;
  /**
   * Mode types that support cursor pagination in addition to `"org-all"`.
   *
   * By default, `--cursor` is rejected in all non-`"org-all"` modes. Callers
   * that implement their own cursor handling (e.g. compound cursors in
   * `issue list`) can list those mode types here to bypass the guard.
   */
  allowCursorInModes?: readonly ParsedOrgProject["type"][];
  /**
   * Behavior when a project-search slug matches a cached organization.
   *
   * Before cursor validation and handler dispatch, the dispatcher checks
   * whether the bare slug matches a cached org. This prevents commands
   * from accidentally treating an org slug as a project name.
   *
   * - `"redirect"` (default): Convert to org-all mode with a warning log.
   *   The existing org-all handler runs naturally.
   * - `"error"`: Throw a {@link ResolutionError} with actionable hints.
   *   Use this when org-all redirect is inappropriate (e.g., issue list
   *   has custom per-project query logic that doesn't support org-all).
   *
   * Cache-only: if the cache is cold or stale, the check is skipped and
   * the handler's own org-slug check serves as a safety net.
   */
  orgSlugMatchBehavior?: "redirect" | "error";
};

/**
 * Pre-check: when a bare slug matches a cached organization, redirect to
 * org-all mode or throw an error before handler dispatch. This prevents
 * commands from accidentally treating an org slug as a project name (CLI-9A).
 *
 * Cache-only: if the cache is cold or stale, returns the original parsed
 * value and the handler's own org-slug check serves as a safety net.
 */
async function resolveOrgSlugMatch(
  parsed: ParsedOrgProject & { type: "project-search" },
  behavior: "redirect" | "error",
  config: ListCommandMeta
): Promise<ParsedOrgProject> {
  const slug = parsed.projectSlug;
  const { getCachedOrganizations } = await import("./db/regions.js");
  const cachedOrgs = getCachedOrganizations();
  const matchingOrg = cachedOrgs.find((o) => o.slug === slug);
  if (!matchingOrg) {
    return parsed;
  }
  if (behavior === "error") {
    throw new ResolutionError(
      `'${slug}'`,
      "is an organization, not a project",
      `${config.commandPrefix} ${slug}/`,
      [
        `List projects: sentry project list ${slug}/`,
        `Specify a project: ${config.commandPrefix} ${slug}/<project>`,
      ]
    );
  }
  log.warn(
    `'${slug}' is an organization, not a project. ` +
      `Listing all ${config.entityPlural} in '${slug}'.`
  );
  return { type: "org-all", org: matchingOrg.slug };
}

/**
 * Resolve DSN-style org identifiers and set org/project context for modes
 * that carry an org field. Returns the (possibly updated) parsed object.
 */
async function resolveOrgInParsed(
  parsed: ParsedOrgProject
): Promise<ParsedOrgProject> {
  if (!("org" in parsed && parsed.org)) {
    return parsed;
  }
  const effectiveOrg = await resolveEffectiveOrg(parsed.org);
  const resolved =
    effectiveOrg !== parsed.org ? { ...parsed, org: effectiveOrg } : parsed;
  if (resolved.type === "explicit" || resolved.type === "org-all") {
    setOrgProjectContext(
      [effectiveOrg],
      resolved.type === "explicit" ? [resolved.project] : []
    );
  }
  return resolved;
}

/**
 * Validate the cursor flag and dispatch to the correct mode handler.
 *
 * Builds a {@link HandlerContext} from the shared fields (cwd, flags,
 * parsed) and passes it to the resolved handler. Merges default handlers
 * with caller-provided overrides using `{ ...defaults, ...overrides }`.
 *
 * Returns the {@link ListResult} from the resolved handler. The caller is
 * responsible for rendering (JSON or human output).
 *
 * This is the single entry point for all org-scoped list commands.
 */
export async function dispatchOrgScopedList<TEntity, TWithOrg>(
  options: DispatchOptions<TEntity, TWithOrg>
  // biome-ignore lint/suspicious/noExplicitAny: TWithOrg varies per command; callers narrow the return type
): Promise<ListResult<any>> {
  const { config, cwd, flags, parsed, overrides } = options;

  let effectiveParsed: ParsedOrgProject = parsed;

  if (
    effectiveParsed.type === "project-search" &&
    options.orgSlugMatchBehavior
  ) {
    effectiveParsed = await resolveOrgSlugMatch(
      effectiveParsed,
      options.orgSlugMatchBehavior,
      config
    );
  }

  const cursorAllowedModes: readonly ParsedOrgProject["type"][] = [
    "org-all",
    ...(options.allowCursorInModes ?? []),
  ];
  if (flags.cursor && !cursorAllowedModes.includes(effectiveParsed.type)) {
    const hint =
      effectiveParsed.type === "project-search"
        ? `\n\nDid you mean '${config.commandPrefix} ${effectiveParsed.projectSlug}/'? ` +
          `A bare name searches for a project — add a trailing slash to list an org's ${config.entityPlural}.`
        : "";
    throw new ValidationError(
      "The --cursor flag requires the <org>/ pattern " +
        `(e.g., ${config.commandPrefix} my-org/).` +
        hint,
      "cursor"
    );
  }

  effectiveParsed = await resolveOrgInParsed(effectiveParsed);

  const defaults = buildDefaultHandlers(config);
  const handlers: ModeHandlerMap = { ...defaults, ...overrides };
  const handler = handlers[effectiveParsed.type];

  const ctx: HandlerContext = {
    parsed: effectiveParsed,
    cwd,
    flags,
  };

  // biome-ignore lint/suspicious/noExplicitAny: safe — dispatch guarantees type match
  return (handler as ModeHandler<any>)(ctx);
}
