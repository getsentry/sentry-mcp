/**
 * List public DSNs for a project or organization using Client Keys fields.
 * Project resolution, output rendering, and cursor history use shared helpers.
 */

import type { SentryContext } from "../../context.js";
import {
  listOrganizationDsns,
  listProjectDsns,
} from "../../lib/api/projects.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import {
  advancePaginationState,
  buildPaginationContextKey,
  hasPreviousPage,
  resolveCursor,
} from "../../lib/db/pagination.js";
import { type DsnListItem, formatDsnList } from "../../lib/formatters/dsn.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  buildListCommand,
  buildListLimitFlag,
  LIST_TARGET_POSITIONAL,
  paginationHint,
  targetPatternExplanation,
} from "../../lib/list-command.js";
import {
  dispatchOrgScopedList,
  type HandlerContext,
  jsonTransformListResult,
  type ListCommandMeta,
  type ListResult,
} from "../../lib/org-list.js";
import { resolveProjectBoundTarget } from "../../lib/resolve-target.js";

const PAGINATION_KEY = "dsn-list";

const listConfig: ListCommandMeta = {
  paginationKey: PAGINATION_KEY,
  entityPlural: "DSNs",
  commandPrefix: "sentry dsn list",
};

type ListFlags = {
  readonly limit: number;
  readonly cursor?: string;
  readonly fresh: boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

/** Keep organization and project cursor histories separate, including page size. */
async function listDsns(
  org: string,
  project: string | undefined,
  flags: HandlerContext["flags"]
): Promise<ListResult<DsnListItem>> {
  const target = project ? `${org}/${project}` : `${org}/`;
  const contextKey = buildPaginationContextKey(
    project ? "project" : "org",
    target,
    { limit: String(flags.limit) }
  );
  const { cursor, direction } = resolveCursor(
    flags.cursor,
    PAGINATION_KEY,
    contextKey
  );
  const options = { limit: flags.limit, cursor };
  const response = project
    ? await listProjectDsns(org, project, options).then((page) => ({
        ...page,
        data: page.data.map((dsn) => ({ ...dsn, project })),
      }))
    : await listOrganizationDsns(org, options);
  const { data, nextCursor } = response;
  advancePaginationState(PAGINATION_KEY, contextKey, direction, nextCursor);
  const hasPrev = hasPreviousPage(PAGINATION_KEY, contextKey);
  const hasMore = !!nextCursor;
  const command = `sentry dsn list ${target} --limit ${flags.limit}`;

  return {
    items: data.map((dsn) => ({ ...dsn, org })),
    hasMore,
    hasPrev,
    nextCursor,
    hint: paginationHint({
      hasPrev,
      hasMore,
      prevHint: `${command} -c prev`,
      nextHint: `${command} -c next`,
    }),
  };
}

async function listForResolvedProject<
  T extends "auto-detect" | "explicit" | "project-search",
>(ctx: HandlerContext<T>): Promise<ListResult<DsnListItem>> {
  const { org, project } = await resolveProjectBoundTarget(
    ctx.parsed,
    ctx.cwd,
    "dsn list",
    { projectSearchResolution: ctx.projectSearchResolution }
  );
  return listDsns(org, project, ctx.flags);
}

export const listCommand = buildListCommand("dsn", {
  docs: {
    brief: "List DSNs",
    fullDescription:
      "List public DSNs with their name, enabled status, and creation date.\n" +
      "Includes enabled and disabled client keys.\n\n" +
      "Use <org>/ to list DSNs across all accessible projects in an organization.\n" +
      "Omit the target to detect the project from your config or DSN.\n" +
      `${targetPatternExplanation()}\n\n` +
      "Examples:\n" +
      "  sentry dsn list\n" +
      "  sentry dsn list my-org/my-project\n" +
      "  sentry dsn list my-org/\n" +
      "  sentry dsn list my-org/ -c next\n" +
      "  sentry dsn list my-org/my-project -c next\n" +
      "  sentry dsn list my-org/my-project --json\n\n" +
      "JSON fields: org, project, name, dsn, isActive, dateCreated.",
  },
  output: {
    human: formatDsnList,
    jsonTransform: (result: ListResult<DsnListItem>, fields?: string[]) =>
      jsonTransformListResult(result, fields),
  },
  parameters: {
    positional: LIST_TARGET_POSITIONAL,
    flags: { limit: buildListLimitFlag("DSNs") },
    aliases: { n: "limit" },
  },
  async *func(this: SentryContext, flags: ListFlags, target?: string) {
    const result: ListResult<DsnListItem> = await dispatchOrgScopedList({
      config: listConfig,
      parsed: parseOrgProjectArg(target),
      cwd: this.cwd,
      flags,
      allowCursorInModes: ["auto-detect", "explicit", "project-search"],
      overrides: {
        "org-all": (ctx) => listDsns(ctx.parsed.org, undefined, ctx.flags),
        explicit: listForResolvedProject,
        "auto-detect": listForResolvedProject,
        "project-search": listForResolvedProject,
      },
    });
    yield new CommandOutput(result);
    return { hint: result.hint };
  },
});
