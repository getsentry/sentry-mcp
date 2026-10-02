/** Shared multi-group budgets preserve items, target order, and resume cursors. */

import { describe, expect, test, vi } from "vitest";
import {
  type FetchResult,
  fetchGroupsWithBudget,
  type GroupFetchOptions,
} from "../../src/lib/org-list.js";

type Page = {
  group: string;
  items: string[];
  hasMore: boolean;
  nextCursor?: string;
};

function page(
  group: string,
  items: string[],
  nextCursor?: string
): FetchResult<Page> {
  return {
    success: true,
    data: { group, items, hasMore: !!nextCursor, nextCursor },
  };
}

const getGroupKey = (group: string) => group;
const getItems = (result: Page) => result.items;

describe("fetchGroupsWithBudget", () => {
  test("shares one global limit and forwards each group's starting cursor", async () => {
    const fetchGroup = vi.fn(
      async (group: string, options: GroupFetchOptions) =>
        page(
          group,
          Array.from(
            { length: options.limit },
            (_, index) => `${group}-${index}`
          ),
          `${group}-next`
        )
    );
    const onProgress = vi.fn();

    const result = await fetchGroupsWithBudget(["a", "b", "c"], {
      limit: 10,
      startCursors: new Map([["b", "b-start"]]),
      getGroupKey,
      getItems,
      fetchGroup,
      onProgress,
    });

    expect(fetchGroup.mock.calls).toEqual([
      ["a", { limit: 4, startCursor: undefined }],
      ["b", { limit: 3, startCursor: "b-start" }],
      ["c", { limit: 3, startCursor: undefined }],
    ]);
    expect(
      result.results.flatMap((entry) => (entry.success ? entry.data.items : []))
    ).toHaveLength(10);
    expect(result.hasMore).toBe(true);
    expect(onProgress.mock.calls).toEqual([[10]]);
  });

  test("redistributes unused slots and merges from each group's next cursor", async () => {
    const fetchGroup = vi.fn(
      async (group: string, options: GroupFetchOptions) => {
        if (options.startCursor) {
          return page(
            group,
            Array.from(
              { length: options.limit },
              (_, index) => `${group}-extra-${index}`
            )
          );
        }
        if (group === "a") {
          return page(group, []);
        }
        // A short page with a cursor remains expandable, as in alert lists.
        const items = group === "b" ? ["b-first"] : ["c-0", "c-1", "c-2"];
        return page(group, items, `${group}-next`);
      }
    );
    const onProgress = vi.fn();

    const result = await fetchGroupsWithBudget(["a", "b", "c"], {
      limit: 9,
      getGroupKey,
      getItems,
      fetchGroup,
      onProgress,
    });

    expect(fetchGroup.mock.calls).toEqual([
      ["a", { limit: 3, startCursor: undefined }],
      ["b", { limit: 3, startCursor: undefined }],
      ["c", { limit: 3, startCursor: undefined }],
      ["b", { limit: 3, startCursor: "b-next" }],
      ["c", { limit: 2, startCursor: "c-next" }],
    ]);
    expect(result).toEqual({
      results: [
        page("a", []),
        page("b", ["b-first", "b-extra-0", "b-extra-1", "b-extra-2"]),
        page("c", ["c-0", "c-1", "c-2", "c-extra-0", "c-extra-1"]),
      ],
      hasMore: false,
    });
    expect(onProgress.mock.calls).toEqual([[4], [9]]);
  });

  test("retains fetched items and their resume cursor if a surplus fetch fails", async () => {
    const failure = new Error("Surplus fetch failed");
    const fetchGroup = vi.fn(
      async (
        group: string,
        options: GroupFetchOptions
      ): Promise<FetchResult<Page>> => {
        if (options.startCursor) {
          return { success: false, error: failure };
        }
        return group === "a"
          ? page(group, [])
          : page(group, ["b-first", "b-second"], "b-retry");
      }
    );
    const onProgress = vi.fn();

    const result = await fetchGroupsWithBudget(["a", "b"], {
      limit: 4,
      getGroupKey,
      getItems,
      fetchGroup,
      onProgress,
    });

    expect(fetchGroup.mock.calls.at(-1)).toEqual([
      "b",
      { limit: 2, startCursor: "b-retry" },
    ]);
    expect(result).toEqual({
      results: [page("a", []), page("b", ["b-first", "b-second"], "b-retry")],
      hasMore: true,
    });
    expect(onProgress.mock.calls).toEqual([[2], [2]]);
  });

  test("preserves failed groups in order while allocating their unused slots", async () => {
    const failure = new Error("Project access denied");
    const fetchGroup = vi.fn(
      async (
        group: string,
        options: GroupFetchOptions
      ): Promise<FetchResult<Page>> => {
        if (group === "a") {
          return { success: false, error: failure };
        }
        return options.startCursor
          ? page(group, ["b-extra"])
          : page(group, ["b-first"], "b-next");
      }
    );

    const result = await fetchGroupsWithBudget(["a", "b"], {
      limit: 2,
      getGroupKey,
      getItems,
      fetchGroup,
      onProgress: vi.fn(),
    });

    expect(fetchGroup.mock.calls.at(-1)).toEqual([
      "b",
      { limit: 1, startCursor: "b-next" },
    ]);
    expect(result).toEqual({
      results: [
        { success: false, error: failure },
        page("b", ["b-first", "b-extra"]),
      ],
      hasMore: false,
    });
  });

  test("fetches one item per group when groups exceed display slots", async () => {
    const fetchGroup = vi.fn(async (group: string) => page(group, [group]));

    const result = await fetchGroupsWithBudget(["a", "b", "c"], {
      limit: 2,
      getGroupKey,
      getItems,
      fetchGroup,
      onProgress: vi.fn(),
    });

    expect(fetchGroup.mock.calls).toEqual([
      ["a", { limit: 1, startCursor: undefined }],
      ["b", { limit: 1, startCursor: undefined }],
      ["c", { limit: 1, startCursor: undefined }],
    ]);
    // The caller needs every group's rows to trim without silently skipping one.
    expect(result).toEqual({
      results: [page("a", ["a"]), page("b", ["b"]), page("c", ["c"])],
      hasMore: false,
    });
  });
});
