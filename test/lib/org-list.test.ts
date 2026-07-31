/**
 * Tests for the shared org-scoped list infrastructure.
 *
 * Covers: fetchOrgSafe, fetchAllOrgs, handleOrgAll, handleAutoDetect,
 * handleExplicitOrg, handleExplicitProject, handleProjectSearch,
 * dispatchOrgScopedList (with and without overrides, metadata-only config).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/lib/api-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/api-client.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../src/lib/api-client.js";

vi.mock("../../src/lib/db/defaults.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/db/defaults.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as defaults from "../../src/lib/db/defaults.js";

vi.mock("../../src/lib/db/pagination.js");

// biome-ignore lint/performance/noNamespaceImport: needed for vi.mocked access
import * as paginationDb from "../../src/lib/db/pagination.js";

vi.mock("../../src/lib/db/regions.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/db/regions.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as regions from "../../src/lib/db/regions.js";
import {
  AuthError,
  ResolutionError,
  ValidationError,
} from "../../src/lib/errors.js";
import {
  dispatchOrgScopedList,
  fetchAllOrgs,
  fetchOrgSafe,
  handleExplicitOrg,
  handleExplicitProject,
  handleOrgAll,
  handleProjectSearch,
  isOrgListConfig,
  type ListCommandMeta,
  type ListResult,
  type OrgListConfig,
} from "../../src/lib/org-list.js";

vi.mock("../../src/lib/polling.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/polling.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as polling from "../../src/lib/polling.js";

vi.mock("../../src/lib/region.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/region.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as region from "../../src/lib/region.js";

vi.mock("../../src/lib/resolve-target.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/resolve-target.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../src/lib/resolve-target.js";

/**
 * Bypass the withProgress spinner in all tests — prevents real stderr
 * timers from piling up during full-suite runs and causing 5s timeouts.
 */
let withProgressSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  withProgressSpy = vi
    .spyOn(polling, "withProgress")
    .mockImplementation((_opts, fn) =>
      fn(() => {
        /* no-op setMessage */
      })
    );
});
afterEach(() => {
  withProgressSpy.mockRestore();
});

type FakeEntity = { id: string; name: string };
type FakeWithOrg = FakeEntity & { orgSlug: string };

function makeConfig(
  overrides?: Partial<OrgListConfig<FakeEntity, FakeWithOrg>>
): OrgListConfig<FakeEntity, FakeWithOrg> {
  return {
    paginationKey: "test-list",
    entityName: "widget",
    entityPlural: "widgets",
    commandPrefix: "sentry widget list",
    listForOrg: vi.fn(() => Promise.resolve([])),
    listPaginated: vi.fn(() =>
      Promise.resolve({ data: [] as FakeEntity[], nextCursor: undefined })
    ),
    withOrg: (entity, orgSlug) => ({ ...entity, orgSlug }),
    displayTable: vi.fn(() => ""),
    ...overrides,
  };
}

const META_ONLY: ListCommandMeta = {
  paginationKey: "meta-list",
  entityName: "thing",
  entityPlural: "things",
  commandPrefix: "sentry thing list",
};

function createStdout() {
  const write = vi.fn((_chunk: string) => true);
  return { writer: { write }, write };
}

// ---------------------------------------------------------------------------
// isOrgListConfig
// ---------------------------------------------------------------------------

describe("isOrgListConfig", () => {
  test("returns true for full OrgListConfig", () => {
    expect(isOrgListConfig(makeConfig())).toBe(true);
  });

  test("returns false for ListCommandMeta only", () => {
    expect(isOrgListConfig(META_ONLY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchOrgSafe
// ---------------------------------------------------------------------------

describe("fetchOrgSafe", () => {
  test("returns entities with org context on success", async () => {
    const items: FakeEntity[] = [
      { id: "1", name: "A" },
      { id: "2", name: "B" },
    ];
    const config = makeConfig({
      listForOrg: vi.fn(() => Promise.resolve(items)),
    });
    const result = await fetchOrgSafe(config, "my-org");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: "1", name: "A", orgSlug: "my-org" });
    expect(result[1]).toEqual({ id: "2", name: "B", orgSlug: "my-org" });
  });

  test("returns empty array on non-auth error", async () => {
    const config = makeConfig({
      listForOrg: vi.fn(() => Promise.reject(new Error("network"))),
    });
    const result = await fetchOrgSafe(config, "my-org");
    expect(result).toEqual([]);
  });

  test("rethrows AuthError", async () => {
    const config = makeConfig({
      listForOrg: vi.fn(() =>
        Promise.reject(new AuthError("not_authenticated"))
      ),
    });
    await expect(fetchOrgSafe(config, "my-org")).rejects.toThrow(AuthError);
  });
});

// ---------------------------------------------------------------------------
// fetchAllOrgs
// ---------------------------------------------------------------------------

describe("fetchAllOrgs", () => {
  let listOrganizationsSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listOrganizationsSpy = vi.spyOn(apiClient, "listOrganizations");
  });

  afterEach(() => {
    listOrganizationsSpy.mockRestore();
  });

  test("fetches entities from all accessible orgs", async () => {
    listOrganizationsSpy.mockResolvedValue([
      { id: "1", slug: "org-a", name: "Org A" },
      { id: "2", slug: "org-b", name: "Org B" },
    ]);

    const items: FakeEntity[] = [{ id: "1", name: "Widget" }];
    const config = makeConfig({
      listForOrg: vi.fn(() => Promise.resolve(items)),
    });

    const result = await fetchAllOrgs(config);
    expect(result).toHaveLength(2);
    expect(result[0]!.orgSlug).toBe("org-a");
    expect(result[1]!.orgSlug).toBe("org-b");
  });

  test("skips orgs with non-auth errors", async () => {
    listOrganizationsSpy.mockResolvedValue([
      { id: "1", slug: "org-a", name: "Org A" },
      { id: "2", slug: "org-b", name: "Org B" },
    ]);

    let callCount = 0;
    const config = makeConfig({
      listForOrg: vi.fn(() => {
        callCount += 1;
        if (callCount === 1) return Promise.reject(new Error("forbidden"));
        return Promise.resolve([{ id: "1", name: "Widget" }]);
      }),
    });

    const result = await fetchAllOrgs(config);
    expect(result).toHaveLength(1);
    expect(result[0]!.orgSlug).toBe("org-b");
  });

  test("rethrows AuthError from any org", async () => {
    listOrganizationsSpy.mockResolvedValue([
      { id: "1", slug: "org-a", name: "Org A" },
    ]);

    const config = makeConfig({
      listForOrg: vi.fn(() =>
        Promise.reject(new AuthError("not_authenticated"))
      ),
    });

    await expect(fetchAllOrgs(config)).rejects.toThrow(AuthError);
  });
});

// ---------------------------------------------------------------------------
// handleOrgAll
// ---------------------------------------------------------------------------

describe("handleOrgAll", () => {
  const advancePaginationStateSpy = vi.mocked(
    paginationDb.advancePaginationState
  );
  const hasPreviousPageSpy = vi.mocked(paginationDb.hasPreviousPage);

  beforeEach(() => {
    advancePaginationStateSpy.mockReturnValue(undefined);
    hasPreviousPageSpy.mockReturnValue(false);
  });

  afterEach(() => {
    advancePaginationStateSpy.mockReset();
    hasPreviousPageSpy.mockReset();
  });

  test("returns ListResult with hasMore=true and nextCursor", async () => {
    const items: FakeEntity[] = [{ id: "1", name: "A" }];
    const config = makeConfig({
      listPaginated: vi.fn(() =>
        Promise.resolve({ data: items, nextCursor: "next:123" })
      ),
    });

    const result = await handleOrgAll({
      config,
      org: "my-org",
      flags: { limit: 10, json: true },
      contextKey: "key",
      cursor: undefined,
      direction: "next",
    });

    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe("next:123");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.orgSlug).toBe("my-org");
  });

  test("returns ListResult with hasMore=false when no nextCursor", async () => {
    const config = makeConfig({
      listPaginated: vi.fn(() =>
        Promise.resolve({
          data: [{ id: "1", name: "A" }],
          nextCursor: undefined,
        })
      ),
    });

    const result = await handleOrgAll({
      config,
      org: "my-org",
      flags: { limit: 10, json: true },
      contextKey: "key",
      cursor: undefined,
      direction: "next",
    });

    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.items).toHaveLength(1);
  });

  test("returns hint with 'no entities found' when empty", async () => {
    const config = makeConfig({
      listPaginated: vi.fn(() =>
        Promise.resolve({ data: [] as FakeEntity[], nextCursor: undefined })
      ),
    });

    const result = await handleOrgAll({
      config,
      org: "my-org",
      flags: { limit: 10, json: false },
      contextKey: "key",
      cursor: undefined,
      direction: "next",
    });

    expect(result.items).toHaveLength(0);
    expect(result.hint).toContain("No widgets found in organization 'my-org'.");
  });

  test("returns hint with next page info when more available", async () => {
    const config = makeConfig({
      listPaginated: vi.fn(() =>
        Promise.resolve({ data: [{ id: "1", name: "A" }], nextCursor: "x" })
      ),
    });

    const result = await handleOrgAll({
      config,
      org: "my-org",
      flags: { limit: 10, json: false },
      contextKey: "key",
      cursor: undefined,
      direction: "next",
    });

    expect(result.header).toContain("more available");
    expect(result.header).toContain("sentry widget list my-org/ -c next");
  });

  test("calls advancePaginationState when nextCursor present", async () => {
    const config = makeConfig({
      listPaginated: vi.fn(() =>
        Promise.resolve({
          data: [{ id: "1", name: "A" }],
          nextCursor: "cursor:abc",
        })
      ),
    });

    await handleOrgAll({
      config,
      org: "my-org",
      flags: { limit: 10, json: false },
      contextKey: "ctx",
      cursor: undefined,
      direction: "next",
    });

    expect(advancePaginationStateSpy).toHaveBeenCalledWith(
      "test-list",
      "ctx",
      "next",
      "cursor:abc"
    );
  });

  test("calls advancePaginationState with undefined when no nextCursor", async () => {
    const config = makeConfig({
      listPaginated: vi.fn(() =>
        Promise.resolve({
          data: [{ id: "1", name: "A" }],
          nextCursor: undefined,
        })
      ),
    });

    await handleOrgAll({
      config,
      org: "my-org",
      flags: { limit: 10, json: false },
      contextKey: "ctx",
      cursor: undefined,
      direction: "next",
    });

    expect(advancePaginationStateSpy).toHaveBeenCalledWith(
      "test-list",
      "ctx",
      "next",
      undefined
    );
  });
});

// ---------------------------------------------------------------------------
// handleExplicitOrg
// ---------------------------------------------------------------------------

describe("handleExplicitOrg", () => {
  test("returns items with org context", async () => {
    const config = makeConfig({
      listForOrg: vi.fn(() => Promise.resolve([{ id: "1", name: "A" }])),
    });

    const result = await handleExplicitOrg({
      config,
      org: "my-org",
      flags: { limit: 10, json: true },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.orgSlug).toBe("my-org");
  });

  test("includes org-scoped note in header when noteOrgScoped=true", async () => {
    const config = makeConfig({
      listForOrg: vi.fn(() => Promise.resolve([{ id: "1", name: "A" }])),
    });

    const result = await handleExplicitOrg({
      config,
      org: "my-org",
      flags: { limit: 10, json: false },
      noteOrgScoped: true,
    });

    expect(result.header).toContain("widgets are org-scoped");
    expect(result.header).toContain("my-org");
  });

  test("does not include org-scoped note when noteOrgScoped=false (default)", async () => {
    const config = makeConfig({
      listForOrg: vi.fn(() => Promise.resolve([{ id: "1", name: "A" }])),
    });

    const result = await handleExplicitOrg({
      config,
      org: "my-org",
      flags: { limit: 10, json: false },
    });

    expect(result.header ?? "").not.toContain("org-scoped");
  });

  test("header includes org-scoped note even in JSON mode (rendering decision is caller's)", async () => {
    const config = makeConfig({
      listForOrg: vi.fn(() => Promise.resolve([{ id: "1", name: "A" }])),
    });

    const result = await handleExplicitOrg({
      config,
      org: "my-org",
      flags: { limit: 10, json: true },
      noteOrgScoped: true,
    });

    // Header is always populated; caller suppresses it in JSON mode
    expect(result.items).toHaveLength(1);
    expect(result.header).toContain("org-scoped");
  });
});

// ---------------------------------------------------------------------------
// handleExplicitProject
// ---------------------------------------------------------------------------

describe("handleExplicitProject", () => {
  test("fetches and returns project-scoped entities", async () => {
    const listForProject = vi.fn(() =>
      Promise.resolve([{ id: "1", name: "Team A" }])
    );
    const config = makeConfig({ listForProject });

    const result = await handleExplicitProject({
      config,
      org: "my-org",
      project: "my-proj",
      flags: { limit: 10, json: true },
    });

    expect(listForProject).toHaveBeenCalledWith("my-org", "my-proj");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.orgSlug).toBe("my-org");
  });

  test("throws when listForProject is not defined on config", async () => {
    const config = makeConfig(); // no listForProject

    await expect(
      handleExplicitProject({
        config,
        org: "my-org",
        project: "my-proj",
        flags: { limit: 10, json: false },
      })
    ).rejects.toThrow("listForProject is not defined");
  });

  test("returns hint with 'no entities found' when project has none", async () => {
    const config = makeConfig({
      listForProject: vi.fn(() => Promise.resolve([])),
    });

    const result = await handleExplicitProject({
      config,
      org: "my-org",
      project: "my-proj",
      flags: { limit: 10, json: false },
    });

    expect(result.items).toHaveLength(0);
    expect(result.hint).toContain("No widgets found");
    expect(result.hint).toContain("my-org/my-proj");
  });
});

// ---------------------------------------------------------------------------
// handleProjectSearch
// ---------------------------------------------------------------------------

describe("handleProjectSearch", () => {
  let findProjectsBySlugSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    findProjectsBySlugSpy = vi.spyOn(apiClient, "findProjectsBySlug");
  });

  afterEach(() => {
    findProjectsBySlugSpy.mockRestore();
  });

  test("throws ResolutionError when no project found", async () => {
    findProjectsBySlugSpy.mockResolvedValue({ projects: [], orgs: [] });
    const config = makeConfig();

    await expect(
      handleProjectSearch(config, "no-such-project", {
        flags: { limit: 10, json: false },
      })
    ).rejects.toThrow(ResolutionError);
  });

  test("returns empty items when no project found with --json", async () => {
    findProjectsBySlugSpy.mockResolvedValue({ projects: [], orgs: [] });
    const config = makeConfig();

    const result = await handleProjectSearch(config, "no-such-project", {
      flags: { limit: 10, json: true },
    });

    expect(result.items).toEqual([]);
  });

  test("with listForProject: fetches project-scoped entities", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [
        { orgSlug: "org-a", slug: "my-proj", id: "1", name: "My Project" },
      ],
      orgs: [],
    });
    const listForProject = vi.fn(() =>
      Promise.resolve([{ id: "1", name: "Team A" }])
    );
    const config = makeConfig({ listForProject });

    const result = await handleProjectSearch(config, "my-proj", {
      flags: { limit: 10, json: true },
    });

    expect(listForProject).toHaveBeenCalledWith("org-a", "my-proj");
    expect(result.items[0]!.orgSlug).toBe("org-a");
  });

  test("without listForProject: fetches from parent org (entity is org-scoped)", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [
        { orgSlug: "org-a", slug: "my-proj", id: "1", name: "My Project" },
      ],
      orgs: [],
    });
    const listForOrg = vi.fn(() =>
      Promise.resolve([{ id: "1", name: "Repo A" }])
    );
    const config = makeConfig({ listForOrg });

    const result = await handleProjectSearch(config, "my-proj", {
      flags: { limit: 10, json: true },
    });

    expect(listForOrg).toHaveBeenCalledWith("org-a");
    expect(result.items[0]!.orgSlug).toBe("org-a");
  });

  test("deduplicates orgs when multiple projects share one org", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [
        { orgSlug: "org-a", slug: "proj-1", id: "1", name: "Proj 1" },
        { orgSlug: "org-a", slug: "proj-2", id: "2", name: "Proj 2" },
      ],
      orgs: [],
    });
    const listForOrg = vi.fn(() =>
      Promise.resolve([{ id: "1", name: "Repo A" }])
    );
    const config = makeConfig({ listForOrg });

    await handleProjectSearch(config, "proj", {
      flags: { limit: 10, json: true },
    });

    // org-a should only be fetched once
    expect(listForOrg).toHaveBeenCalledTimes(1);
  });

  test("calls orgAllFallback when slug matches an org and fallback provided", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [],
      orgs: [{ slug: "acme-corp", name: "Acme Corp" }],
    });
    const config = makeConfig();
    const fallback = vi.fn(() =>
      Promise.resolve({ items: [] } as ListResult<FakeWithOrg>)
    );

    await handleProjectSearch(config, "acme-corp", {
      flags: { limit: 10, json: false },
      orgAllFallback: fallback,
    });

    expect(fallback).toHaveBeenCalledWith("acme-corp");
  });

  test("throws ResolutionError when slug matches an org but no fallback", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [],
      orgs: [{ slug: "acme-corp", name: "Acme Corp" }],
    });
    const config = makeConfig();

    await expect(
      handleProjectSearch(config, "acme-corp", {
        flags: { limit: 10, json: false },
      })
    ).rejects.toThrow(ResolutionError);
  });

  test("includes multi-org note in hint when project found in multiple orgs", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [
        { orgSlug: "org-a", slug: "my-proj", id: "1", name: "My Project" },
        { orgSlug: "org-b", slug: "my-proj", id: "2", name: "My Project" },
      ],
      orgs: [],
    });
    const config = makeConfig({
      listForOrg: vi.fn(() => Promise.resolve([{ id: "1", name: "Widget" }])),
    });

    const result = await handleProjectSearch(config, "my-proj", {
      flags: { limit: 10, json: false },
    });

    expect(result.hint).toContain("2 organizations");
  });

  test("scopes matches to the explicit org, ignoring a same-slug project in another org", async () => {
    // findProjectsBySlug fans out across orgs and finds the slug in BOTH
    // org-a (the requested scope) and org-b. With an explicit org the result
    // must only fetch from org-a — never leak org-b.
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [
        { orgSlug: "org-b", slug: "my-proj", id: "2", name: "My Project" },
        { orgSlug: "org-a", slug: "my-proj", id: "1", name: "My Project" },
      ],
      orgs: [
        { slug: "org-a", name: "Org A" },
        { slug: "org-b", name: "Org B" },
      ],
    });
    const listForOrg = vi.fn(() =>
      Promise.resolve([{ id: "1", name: "Widget" }])
    );
    const config = makeConfig({ listForOrg });

    const result = await handleProjectSearch(config, "my-proj", {
      flags: { limit: 10, json: false },
      org: "org-a",
    });

    expect(listForOrg).toHaveBeenCalledTimes(1);
    expect(listForOrg).toHaveBeenCalledWith("org-a");
    expect(result.items.every((i) => i.orgSlug === "org-a")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dispatchOrgScopedList — cursor validation and handler map pattern
// ---------------------------------------------------------------------------

describe("dispatchOrgScopedList", () => {
  let getDefaultOrganizationSpy: ReturnType<typeof spyOn>;
  let resolveAllTargetsSpy: ReturnType<typeof spyOn>;
  let advancePaginationStateSpy: ReturnType<typeof spyOn>;
  let hasPreviousPageSpy: ReturnType<typeof spyOn>;
  let resolveCursorSpy: ReturnType<typeof spyOn>;
  let resolveEffectiveOrgSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getDefaultOrganizationSpy = vi.spyOn(defaults, "getDefaultOrganization");
    resolveAllTargetsSpy = vi.spyOn(resolveTarget, "resolveAllTargets");
    advancePaginationStateSpy = vi
      .spyOn(paginationDb, "advancePaginationState")
      .mockReturnValue(undefined);
    hasPreviousPageSpy = vi
      .spyOn(paginationDb, "hasPreviousPage")
      .mockReturnValue(false);
    resolveCursorSpy = vi.spyOn(paginationDb, "resolveCursor").mockReturnValue({
      cursor: undefined,
      direction: "next" as const,
    });
    // Prevent resolveEffectiveOrg from making real HTTP calls during
    // full-suite runs where earlier tests may leave auth state behind.
    resolveEffectiveOrgSpy = vi
      .spyOn(region, "resolveEffectiveOrg")
      .mockImplementation((org: string) => Promise.resolve(org));

    getDefaultOrganizationSpy.mockReturnValue(null);
    resolveAllTargetsSpy.mockResolvedValue({ targets: [] });
  });

  afterEach(() => {
    getDefaultOrganizationSpy.mockRestore();
    resolveAllTargetsSpy.mockRestore();
    advancePaginationStateSpy.mockRestore();
    hasPreviousPageSpy.mockRestore();
    resolveCursorSpy.mockRestore();
    resolveEffectiveOrgSpy.mockRestore();
  });

  test("throws ValidationError when --cursor used outside org-all mode", async () => {
    const config = makeConfig();
    const { writer } = createStdout();

    await expect(
      dispatchOrgScopedList({
        config,
        stdout: writer,
        cwd: "/tmp",
        flags: { limit: 10, json: false, cursor: "some-cursor" },
        parsed: { type: "explicit", org: "my-org", project: "my-proj" },
      })
    ).rejects.toThrow(ValidationError);
  });

  test("error message includes entity plural name", async () => {
    const config = makeConfig();
    const { writer } = createStdout();

    try {
      await dispatchOrgScopedList({
        config,
        stdout: writer,
        cwd: "/tmp",
        flags: { limit: 10, json: false, cursor: "x" },
        parsed: { type: "auto-detect" },
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).message).toContain("<org>/");
    }
  });

  test("delegates to handleOrgAll for org-all mode and returns ListResult", async () => {
    const items: FakeEntity[] = [{ id: "1", name: "A" }];
    const config = makeConfig({
      listPaginated: vi.fn(() =>
        Promise.resolve({ data: items, nextCursor: undefined })
      ),
    });
    const { writer } = createStdout();

    const result = await dispatchOrgScopedList({
      config,
      stdout: writer,
      cwd: "/tmp",
      flags: { limit: 10, json: true },
      parsed: { type: "org-all", org: "my-org" },
    });

    expect(result.hasMore).toBe(false);
    expect(result.items).toHaveLength(1);
  });

  test("explicit mode uses listForProject when available", async () => {
    const listForProject = vi.fn(() =>
      Promise.resolve([{ id: "1", name: "T" }])
    );
    const config = makeConfig({ listForProject });
    const { writer } = createStdout();

    const result = await dispatchOrgScopedList({
      config,
      stdout: writer,
      cwd: "/tmp",
      flags: { limit: 10, json: true },
      parsed: { type: "explicit", org: "my-org", project: "my-proj" },
    });

    expect(listForProject).toHaveBeenCalledWith("my-org", "my-proj");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].orgSlug).toBe("my-org");
  });

  test("explicit mode falls back to org-scoped with note when no listForProject", async () => {
    const listForOrg = vi.fn(() => Promise.resolve([{ id: "1", name: "R" }]));
    const config = makeConfig({ listForOrg }); // no listForProject
    const { writer } = createStdout();

    const result = await dispatchOrgScopedList({
      config,
      stdout: writer,
      cwd: "/tmp",
      flags: { limit: 10, json: false },
      parsed: { type: "explicit", org: "my-org", project: "my-proj" },
    });

    expect(listForOrg).toHaveBeenCalledWith("my-org");
    expect(result.header).toContain("org-scoped");
  });

  test("override replaces default handler for that mode", async () => {
    const config = makeConfig();
    const { writer } = createStdout();
    const overrideCalled = vi.fn(() =>
      Promise.resolve({ items: [] } as ListResult<FakeWithOrg>)
    );

    await dispatchOrgScopedList({
      config,
      stdout: writer,
      cwd: "/tmp",
      flags: { limit: 10, json: false },
      parsed: { type: "auto-detect" },
      overrides: {
        "auto-detect": overrideCalled,
      },
    });

    expect(overrideCalled).toHaveBeenCalledTimes(1);
  });

  test("override does not affect other modes", async () => {
    const items: FakeEntity[] = [{ id: "1", name: "A" }];
    const config = makeConfig({
      listPaginated: vi.fn(() =>
        Promise.resolve({ data: items, nextCursor: undefined })
      ),
    });
    const { writer } = createStdout();
    const autoDetectOverride = vi.fn(() =>
      Promise.resolve({ items: [] } as ListResult<FakeWithOrg>)
    );

    const result = await dispatchOrgScopedList({
      config,
      stdout: writer,
      cwd: "/tmp",
      flags: { limit: 10, json: true },
      parsed: { type: "org-all", org: "my-org" },
      overrides: {
        "auto-detect": autoDetectOverride, // overrides auto-detect, not org-all
      },
    });

    // org-all default handler ran, not the auto-detect override
    expect(autoDetectOverride).not.toHaveBeenCalled();
    expect(result.hasMore).toBe(false);
  });

  test("metadata-only config with full overrides dispatches correctly", async () => {
    const { writer } = createStdout();
    const handler = vi.fn(() =>
      Promise.resolve({ items: [] } as ListResult<unknown>)
    );

    await dispatchOrgScopedList({
      config: META_ONLY,
      stdout: writer,
      cwd: "/tmp",
      flags: { limit: 10, json: false },
      parsed: { type: "explicit", org: "my-org", project: "my-proj" },
      overrides: {
        "auto-detect": handler,
        explicit: handler,
        "project-search": handler,
        "org-all": handler,
      },
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("metadata-only config without override for invoked mode throws", async () => {
    const { writer } = createStdout();

    await expect(
      dispatchOrgScopedList({
        config: META_ONLY,
        stdout: writer,
        cwd: "/tmp",
        flags: { limit: 10, json: false },
        parsed: { type: "auto-detect" },
        overrides: {
          // missing auto-detect override — should throw
          explicit: vi.fn(() =>
            Promise.resolve({ items: [] } as ListResult<unknown>)
          ),
        },
      })
    ).rejects.toThrow("No handler for 'auto-detect' mode");
  });

  test("project-search invokes runOrgAll when slug matches an org", async () => {
    // When dispatchOrgScopedList uses the default project-search handler with a
    // full OrgListConfig, and the slug matches an org (no projects found), the
    // handler calls runOrgAll as the orgAllFallback.
    const findProjectsBySlugSpy = vi.spyOn(apiClient, "findProjectsBySlug");
    const localAdvanceSpy = vi
      .spyOn(paginationDb, "advancePaginationState")
      .mockReturnValue(undefined);
    const localHasPrevSpy = vi
      .spyOn(paginationDb, "hasPreviousPage")
      .mockReturnValue(false);

    findProjectsBySlugSpy.mockResolvedValue({
      projects: [],
      orgs: [{ id: "1", slug: "acme-corp", name: "Acme Corp" }],
    });

    const items: FakeEntity[] = [{ id: "1", name: "Widget A" }];
    const config = makeConfig({
      listPaginated: vi.fn(() =>
        Promise.resolve({ data: items, nextCursor: undefined })
      ),
    });
    const { writer } = createStdout();

    const result = await dispatchOrgScopedList({
      config,
      stdout: writer,
      cwd: "/tmp",
      flags: { limit: 10, json: true },
      parsed: { type: "project-search", projectSlug: "acme-corp" },
    });

    // runOrgAll should have called handleOrgAll → listPaginated
    expect(config.listPaginated).toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("Widget A");

    findProjectsBySlugSpy.mockRestore();
    localAdvanceSpy.mockRestore();
    localHasPrevSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // orgSlugMatchBehavior pre-check
  // -------------------------------------------------------------------------

  describe("orgSlugMatchBehavior", () => {
    let getCachedOrgsSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      getCachedOrgsSpy = vi
        .spyOn(regions, "getCachedOrganizations")
        .mockReturnValue([]);
    });

    afterEach(() => {
      getCachedOrgsSpy.mockRestore();
    });

    test("redirect converts project-search to org-all when slug matches cached org", async () => {
      getCachedOrgsSpy.mockReturnValue([
        { slug: "acme-corp", id: "1", name: "Acme Corp" },
      ]);

      const items: FakeEntity[] = [{ id: "1", name: "Widget A" }];
      const config = makeConfig({
        listPaginated: vi.fn(() =>
          Promise.resolve({ data: items, nextCursor: undefined })
        ),
      });

      const result = await dispatchOrgScopedList({
        config,
        cwd: "/tmp",
        flags: { limit: 10, json: true },
        parsed: { type: "project-search", projectSlug: "acme-corp" },
        orgSlugMatchBehavior: "redirect",
      });

      // Should have redirected to org-all → listPaginated called
      expect(config.listPaginated).toHaveBeenCalled();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].orgSlug).toBe("acme-corp");
    });

    test("error throws ResolutionError when slug matches cached org", async () => {
      getCachedOrgsSpy.mockReturnValue([
        { slug: "acme-corp", id: "1", name: "Acme Corp" },
      ]);

      const config = makeConfig();

      await expect(
        dispatchOrgScopedList({
          config,
          cwd: "/tmp",
          flags: { limit: 10, json: false },
          parsed: { type: "project-search", projectSlug: "acme-corp" },
          orgSlugMatchBehavior: "error",
        })
      ).rejects.toThrow(ResolutionError);
    });

    test("error message includes actionable hints", async () => {
      getCachedOrgsSpy.mockReturnValue([
        { slug: "acme-corp", id: "1", name: "Acme Corp" },
      ]);

      const config = makeConfig();

      try {
        await dispatchOrgScopedList({
          config,
          cwd: "/tmp",
          flags: { limit: 10, json: false },
          parsed: { type: "project-search", projectSlug: "acme-corp" },
          orgSlugMatchBehavior: "error",
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ResolutionError);
        const err = e as ResolutionError;
        expect(err.message).toContain("is an organization, not a project");
        expect(err.message).toContain("acme-corp/");
      }
    });

    test("no orgSlugMatchBehavior skips pre-check and calls handler", async () => {
      getCachedOrgsSpy.mockReturnValue([
        { slug: "acme-corp", id: "1", name: "Acme Corp" },
      ]);

      const handler = vi.fn(() =>
        Promise.resolve({ items: [] } as ListResult<FakeWithOrg>)
      );

      await dispatchOrgScopedList({
        config: META_ONLY,
        cwd: "/tmp",
        flags: { limit: 10, json: false },
        parsed: { type: "project-search", projectSlug: "acme-corp" },
        overrides: {
          "auto-detect": handler,
          explicit: handler,
          "project-search": handler,
          "org-all": handler,
        },
      });

      // Without orgSlugMatchBehavior, the project-search handler runs
      expect(handler).toHaveBeenCalledTimes(1);
      // getCachedOrganizations should NOT have been called
      expect(getCachedOrgsSpy).not.toHaveBeenCalled();
    });

    test("redirect with no cache match falls through to project-search handler", async () => {
      getCachedOrgsSpy.mockReturnValue([
        { slug: "other-org", id: "2", name: "Other Org" },
      ]);

      const handler = vi.fn(() =>
        Promise.resolve({ items: [] } as ListResult<FakeWithOrg>)
      );

      await dispatchOrgScopedList({
        config: META_ONLY,
        cwd: "/tmp",
        flags: { limit: 10, json: false },
        parsed: { type: "project-search", projectSlug: "acme-corp" },
        orgSlugMatchBehavior: "redirect",
        overrides: {
          "auto-detect": handler,
          explicit: handler,
          "project-search": handler,
          "org-all": handler,
        },
      });

      // No cache match → project-search handler still called
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test("redirect with empty cache falls through to project-search handler", async () => {
      getCachedOrgsSpy.mockReturnValue([]);

      const handler = vi.fn(() =>
        Promise.resolve({ items: [] } as ListResult<FakeWithOrg>)
      );

      await dispatchOrgScopedList({
        config: META_ONLY,
        cwd: "/tmp",
        flags: { limit: 10, json: false },
        parsed: { type: "project-search", projectSlug: "acme-corp" },
        orgSlugMatchBehavior: "redirect",
        overrides: {
          "auto-detect": handler,
          explicit: handler,
          "project-search": handler,
          "org-all": handler,
        },
      });

      // Empty cache → project-search handler still called
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
