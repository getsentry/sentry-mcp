/** Shared helpers for alert list commands. */

import { ApiError, ValidationError } from "../../lib/errors.js";
import { LIST_MAX_LIMIT } from "../../lib/list-command.js";
import { distributeFetchBudget, type FetchResult } from "../../lib/org-list.js";

export type AlertRuleFetchPage<TRule> = {
  rules: TRule[];
  hasMore?: boolean;
  nextCursor?: string;
};

type FetchPageOptions = { limit: number; startCursor?: string };
type BudgetOptions<TGroup, TRule, TPage extends AlertRuleFetchPage<TRule>> = {
  limit: number;
  startCursors?: Map<string, string>;
  getGroupKey: (group: TGroup) => string;
  fetchGroup: (
    group: TGroup,
    options: FetchPageOptions
  ) => Promise<FetchResult<TPage>>;
  onProgress: (fetched: number) => void;
};

export function assertAlertListLimit(limit: number): void {
  if (limit < 1) {
    throw new ValidationError("--limit must be at least 1.", "limit");
  }
  if (limit > LIST_MAX_LIMIT) {
    throw new ValidationError(
      `--limit cannot exceed ${LIST_MAX_LIMIT}. ` +
        "Use --cursor to paginate through larger result sets.",
      "limit"
    );
  }
}

export function throwAlertListFetchFailure(
  prefix: string,
  error: Error
): never {
  if (!(error instanceof ApiError)) {
    throw new Error(`${prefix}: ${error.message}`);
  }
  throw new ApiError(
    `${prefix}: ${error.message}`,
    error.status,
    error.detail,
    error.endpoint,
    error.enriched403
  );
}

export function buildAlertListFailureErrors<TKey extends string, TFailure>(
  failures: TFailure[],
  labelKey: TKey,
  getLabel: (failure: TFailure) => string,
  getError: (failure: TFailure) => Error
): (Record<TKey, string> & { status?: number; message: string })[] | undefined {
  if (failures.length === 0) {
    return;
  }
  return failures.map((failure) => {
    const error = getError(failure);
    return {
      [labelKey]: getLabel(failure),
      ...(error instanceof ApiError && { status: error.status }),
      message: error.message,
    } as Record<TKey, string> & { status?: number; message: string };
  });
}

function countFetched<TRule, TPage extends AlertRuleFetchPage<TRule>>(
  results: FetchResult<TPage>[]
): number {
  return results.reduce(
    (total, result) => total + (result.success ? result.data.rules.length : 0),
    0
  );
}

function hasMore<TRule, TPage extends AlertRuleFetchPage<TRule>>(
  results: FetchResult<TPage>[]
): boolean {
  return results.some((result) => result.success && result.data.hasMore);
}

export async function fetchAlertRulesWithBudget<
  TGroup,
  TRule,
  TPage extends AlertRuleFetchPage<TRule>,
>(
  groups: TGroup[],
  options: BudgetOptions<TGroup, TRule, TPage>
): Promise<{ results: FetchResult<TPage>[]; hasMore: boolean }> {
  const { limit, startCursors, getGroupKey, fetchGroup, onProgress } = options;
  const quotas = distributeFetchBudget(limit, groups.length, {
    minimumPerGroup: true,
  });
  const phase1 = await Promise.all(
    groups.map((group, index) =>
      fetchGroup(group, {
        limit: quotas[index] ?? 1,
        startCursor: startCursors?.get(getGroupKey(group)),
      })
    )
  );

  let totalFetched = countFetched(phase1);
  onProgress(totalFetched);

  const surplus = limit - totalFetched;
  if (surplus <= 0) {
    return { results: phase1, hasMore: hasMore(phase1) };
  }

  const expandable = phase1.flatMap((result, index) => {
    const group = groups[index];
    if (!(group && result.success && result.data.nextCursor)) {
      return [];
    }
    return [{ group, index, cursor: result.data.nextCursor }];
  });
  const extraQuotas = distributeFetchBudget(surplus, expandable.length);
  const requests = expandable.flatMap((request, index) => {
    const extraLimit = extraQuotas[index] ?? 0;
    return extraLimit > 0 ? [{ ...request, limit: extraLimit }] : [];
  });

  const phase2 = await Promise.all(
    requests.map(({ group, limit: requestLimit, cursor }) =>
      fetchGroup(group, { limit: requestLimit, startCursor: cursor })
    )
  );
  for (let index = 0; index < requests.length; index++) {
    const request = requests[index];
    const p1 = request ? phase1[request.index] : undefined;
    const p2 = phase2[index];
    if (p1?.success && p2?.success) {
      p1.data.rules.push(...p2.data.rules);
      p1.data.hasMore = p2.data.hasMore;
      p1.data.nextCursor = p2.data.nextCursor;
    }
  }

  totalFetched = countFetched(phase1);
  onProgress(totalFetched);
  return { results: phase1, hasMore: hasMore(phase1) };
}
