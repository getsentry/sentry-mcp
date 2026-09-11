/**
 * Tests for init organization preflight and app-scoped project resolution.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../src/lib/api-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/api-client.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === "function" ? vi.fn(value) : value,
    ])
  );
});

vi.mock("../../../src/lib/db/auth.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/db/auth.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === "function" ? vi.fn(value) : value,
    ])
  );
});

vi.mock("../../../src/lib/init/org-prefetch.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/lib/init/org-prefetch.js")
    >();
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === "function" ? vi.fn(value) : value,
    ])
  );
});

vi.mock(
  "../../../src/lib/init/tools/detect-sentry.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../src/lib/init/tools/detect-sentry.js")
      >();
    return { ...actual, detectSentrySetup: vi.fn(actual.detectSentrySetup) };
  }
);

vi.mock("../../../src/lib/resolve-target.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/resolve-target.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === "function" ? vi.fn(value) : value,
    ])
  );
});

vi.mock("../../../src/lib/scope-recovery.js", () => ({
  captureOAuthScopeRecoveryGate: vi.fn(),
}));

// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as auth from "../../../src/lib/db/auth.js";
import { ApiError } from "../../../src/lib/errors.js";
import { WizardCancelledError } from "../../../src/lib/init/clack-utils.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as prefetch from "../../../src/lib/init/org-prefetch.js";
import {
  resolveInitContext,
  resolveInitProjectContext,
} from "../../../src/lib/init/preflight.js";
// biome-ignore lint/performance/noNamespaceImport: mocked at the module boundary
import * as detector from "../../../src/lib/init/tools/detect-sentry.js";
import type {
  ResolvedInitContext,
  WizardOptions,
} from "../../../src/lib/init/types.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as resolveTarget from "../../../src/lib/resolve-target.js";
// biome-ignore lint/performance/noNamespaceImport: mocked at the module boundary
import * as scopeRecovery from "../../../src/lib/scope-recovery.js";
import { createMockUI } from "./ui/mock-ui.js";

function makeOptions(overrides?: Partial<WizardOptions>): WizardOptions {
  return {
    directory: "/work/checkout",
    yes: true,
    dryRun: false,
    ...overrides,
  };
}

function makeContext(
  overrides?: Partial<ResolvedInitContext>
): ResolvedInitContext {
  return {
    directory: "/work/checkout",
    yes: false,
    dryRun: false,
    org: "acme",
    ...overrides,
  };
}

function makeProject(slug: string, name = slug) {
  return {
    id: `id-${slug}`,
    slug,
    name,
    platform: "javascript-react",
    dateCreated: "2026-04-16T00:00:00Z",
  } as any;
}

let resolveOrgPrefetchedSpy: ReturnType<typeof vi.spyOn>;
let listOrganizationsSpy: ReturnType<typeof vi.spyOn>;
let listProjectsSpy: ReturnType<typeof vi.spyOn>;
let getProjectSpy: ReturnType<typeof vi.spyOn>;
let tryGetPrimaryDsnSpy: ReturnType<typeof vi.spyOn>;
let getAuthTokenSpy: ReturnType<typeof vi.spyOn>;
let resolveAllTargetsSpy: ReturnType<typeof vi.spyOn>;
let detectSentrySetupSpy: ReturnType<typeof vi.spyOn>;
let shouldDelegateScopeRecovery: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resolveOrgPrefetchedSpy = vi
    .spyOn(prefetch, "resolveOrgPrefetched")
    .mockResolvedValue({ org: "acme" });
  listOrganizationsSpy = vi
    .spyOn(apiClient, "listOrganizations")
    .mockResolvedValue([{ id: "1", slug: "acme", name: "Acme" }]);
  listProjectsSpy = vi.spyOn(apiClient, "listProjects").mockResolvedValue([]);
  getProjectSpy = vi
    .spyOn(apiClient, "getProject")
    .mockImplementation(async (_org, slug) => {
      if (slug === "junior" || slug === "frontend") {
        return makeProject(slug);
      }
      throw new ApiError("not found", 404);
    });
  tryGetPrimaryDsnSpy = vi
    .spyOn(apiClient, "tryGetPrimaryDsn")
    .mockResolvedValue("https://abc@o1.ingest.sentry.io/42");
  getAuthTokenSpy = vi
    .spyOn(auth, "getAuthToken")
    .mockReturnValue("sntrys_test");
  resolveAllTargetsSpy = vi
    .spyOn(resolveTarget, "resolveAllTargets")
    .mockResolvedValue({ targets: [] });
  detectSentrySetupSpy = vi
    .spyOn(detector, "detectSentrySetup")
    .mockResolvedValue({ status: "none", signals: [] });
  shouldDelegateScopeRecovery = vi.fn().mockResolvedValue(false);
  vi.mocked(scopeRecovery.captureOAuthScopeRecoveryGate).mockReturnValue({
    shouldDelegate: shouldDelegateScopeRecovery,
  });
});

afterEach(() => {
  resolveOrgPrefetchedSpy.mockRestore();
  listOrganizationsSpy.mockRestore();
  listProjectsSpy.mockRestore();
  getProjectSpy.mockRestore();
  tryGetPrimaryDsnSpy.mockRestore();
  getAuthTokenSpy.mockRestore();
  resolveAllTargetsSpy.mockRestore();
  detectSentrySetupSpy.mockRestore();
  vi.mocked(scopeRecovery.captureOAuthScopeRecoveryGate).mockReset();
  process.exitCode = 0;
});

describe("resolveInitContext", () => {
  test("uses codebase resolution for the org but defers the project until app selection", async () => {
    const { ui } = createMockUI();

    const context = await resolveInitContext(makeOptions({ yes: false }), ui);

    expect(context).toEqual(
      expect.objectContaining({
        org: "acme",
        project: undefined,
      })
    );
    expect(context?.existingProject).toBeUndefined();
    expect(resolveAllTargetsSpy).toHaveBeenCalledWith({
      cwd: "/work/checkout",
      resolutionMode: "codebase",
    });
    expect(listProjectsSpy).not.toHaveBeenCalled();
  });

  test("avoids the organization prompt when the repository maps to one org", async () => {
    resolveOrgPrefetchedSpy.mockResolvedValue(null);
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "sentry",
          project: "junior",
          matchStrength: "exact",
        },
      ],
    });
    const { ui, calls } = createMockUI();

    const context = await resolveInitContext(
      makeOptions({ directory: "/work/junior", yes: false }),
      ui
    );

    expect(context?.org).toBe("sentry");
    expect(context?.project).toBeUndefined();
    expect(calls.filter((call) => call.kind === "select")).toHaveLength(0);
    expect(listOrganizationsSpy).not.toHaveBeenCalled();
  });

  test("preserves explicit project and team inputs without resolving them early", async () => {
    const { ui } = createMockUI();

    const context = await resolveInitContext(
      makeOptions({ project: "junior", team: "backend" }),
      ui
    );

    expect(context?.project).toBe("junior");
    expect(context?.team).toEqual({ slug: "backend", source: "explicit" });
    expect(getProjectSpy).not.toHaveBeenCalled();
  });

  test("sorts organization options before prompting", async () => {
    resolveOrgPrefetchedSpy.mockResolvedValue(null);
    listOrganizationsSpy.mockResolvedValue([
      { id: "1", slug: "z-org", name: "Alpha" },
      { id: "2", slug: "beta", name: "Beta" },
      { id: "3", slug: "a-org", name: "Alpha" },
    ]);
    const { ui, calls, respond } = createMockUI();
    respond.select("a-org");

    const context = await resolveInitContext(makeOptions({ yes: false }), ui);

    expect(context?.org).toBe("a-org");
    expect(calls.find((call) => call.kind === "select")).toEqual({
      kind: "select",
      message: "Which organization should Sentry use?",
      options: ["a-org", "z-org", "beta"],
    });
  });

  test("preserves an organization 403 when OAuth recovery can run", async () => {
    const error = new ApiError("Forbidden", 403, "Missing org:read");
    resolveOrgPrefetchedSpy.mockResolvedValue(null);
    listOrganizationsSpy.mockRejectedValueOnce(error);
    shouldDelegateScopeRecovery.mockResolvedValueOnce(true);
    const { ui } = createMockUI();

    await expect(
      resolveInitContext(makeOptions({ yes: false }), ui)
    ).rejects.toBe(error);
  });

  test("renders organization guidance when OAuth recovery cannot run", async () => {
    resolveOrgPrefetchedSpy.mockResolvedValue(null);
    listOrganizationsSpy.mockRejectedValueOnce(
      new ApiError("Forbidden", 403, "Missing org:read")
    );
    const { ui, calls } = createMockUI();

    await expect(resolveInitContext(makeOptions(), ui)).rejects.toThrow(
      "403 Forbidden"
    );
    expect(calls.find((call) => call.kind === "log.error")).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("sentry init <org-slug>/"),
      })
    );
  });

  test("includes the auth token in the resolved context", async () => {
    const { ui } = createMockUI();

    const context = await resolveInitContext(makeOptions(), ui);

    expect(context?.authToken).toBe("sntrys_test");
  });
});

describe("resolveInitProjectContext", () => {
  test("uses the selected app directory for shared project resolution", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          orgDisplay: "Acme",
          projectDisplay: "Junior",
          matchStrength: "exact",
        },
      ],
    });
    const { ui } = createMockUI();

    const result = await resolveInitProjectContext(
      makeContext({ yes: true }),
      "/work/checkout/apps/junior",
      ui
    );

    expect(result.existingProject?.projectSlug).toBe("junior");
    expect(resolveAllTargetsSpy).toHaveBeenCalledWith({
      cwd: "/work/checkout/apps/junior",
      resolutionMode: "codebase",
      organizationFilter: "acme",
    });
    expect(detectSentrySetupSpy).toHaveBeenCalledWith(
      "/work/checkout/apps/junior"
    );
  });

  test("offers improvement when both the setup and project are detected", async () => {
    detectSentrySetupSpy.mockResolvedValue({
      status: "installed",
      signals: ["init: src/instrumentation.ts"],
    });
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          orgDisplay: "Acme",
          projectDisplay: "Junior",
          matchStrength: "exact",
        },
      ],
    });
    const { ui, calls, respond } = createMockUI();
    const selectSpy = vi.spyOn(ui, "select");
    respond.select("improve");

    const result = await resolveInitProjectContext(
      makeContext(),
      "/work/checkout/apps/junior",
      ui,
      { supportsExistingSetupImprovement: true }
    );

    expect(result.existingProject?.projectSlug).toBe("junior");
    expect(calls.filter((call) => call.kind.startsWith("log."))).toEqual([]);
    expect(calls).toContainEqual({
      kind: "select",
      message:
        "Sentry detected for project junior in organization acme. What would you like to do?",
      options: ["improve", "other"],
    });
    expect(selectSpy.mock.calls[0]?.[0].options).toEqual([
      expect.objectContaining({
        value: "improve",
        label: "Improve your Sentry setup",
        description: "Upgrade your current setup and add more Sentry features.",
      }),
      expect.objectContaining({
        value: "other",
        label: "Use or create another Sentry project",
        description: "Use another project or create a new one.",
      }),
    ]);
    expect(result).toEqual({
      org: "acme",
      project: "junior",
      existingProject: expect.objectContaining({ projectSlug: "junior" }),
      setupIntent: "improve-existing",
    });
  });

  test("canonicalizes numeric DSN identity after loading the project", async () => {
    const detectedDsn = "https://abc@o1.ingest.sentry.io/42";
    detectSentrySetupSpy.mockResolvedValue({
      status: "installed",
      dsn: detectedDsn,
      signals: ["init: src/instrumentation.ts"],
    });
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "1",
          project: "42",
          projectId: 42,
          matchStrength: "exact",
          detectedDsn: {
            raw: detectedDsn,
            protocol: "https",
            publicKey: "abc",
            host: "o1.ingest.sentry.io",
            orgId: "1",
            projectId: "42",
            source: "code",
            sourcePath: "src/instrumentation.ts",
          },
        },
      ],
    });
    getProjectSpy.mockResolvedValueOnce({
      ...makeProject("junior", "Junior"),
      id: "42",
      organization: { id: "1", slug: "sentry", name: "Sentry" },
    });
    const { ui } = createMockUI();

    const result = await resolveInitProjectContext(
      makeContext({ org: "1", yes: true }),
      "/work/checkout/apps/junior",
      ui,
      { supportsExistingSetupImprovement: true }
    );

    expect(getProjectSpy).toHaveBeenCalledWith("1", "42");
    expect(tryGetPrimaryDsnSpy).toHaveBeenCalledWith("sentry", "junior");
    expect(result).toEqual({
      org: "sentry",
      project: "junior",
      existingProject: expect.objectContaining({
        orgSlug: "sentry",
        projectSlug: "junior",
        projectId: "42",
      }),
      setupIntent: "improve-existing",
    });
  });

  test("keeps auto-resolved detection details out of the dry-run log", async () => {
    detectSentrySetupSpy.mockResolvedValue({
      status: "installed",
      signals: ["init: src/instrumentation.ts"],
    });
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          matchStrength: "exact",
        },
      ],
    });
    const { ui, calls } = createMockUI();

    const result = await resolveInitProjectContext(
      makeContext({ dryRun: true, yes: true }),
      "/work/checkout/apps/junior",
      ui,
      { supportsExistingSetupImprovement: true }
    );

    expect(result.setupIntent).toBe("improve-existing");
    expect(calls.filter((call) => call.kind.startsWith("log."))).toEqual([]);
  });

  test("preserves the detected local DSN when project-key lookup returns none", async () => {
    tryGetPrimaryDsnSpy.mockResolvedValueOnce(null);
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          orgDisplay: "Acme",
          projectDisplay: "Junior",
          matchStrength: "exact",
          detectedDsn: {
            protocol: "https",
            publicKey: "local",
            host: "o1.ingest.sentry.io",
            projectId: "id-junior",
            raw: "https://local@o1.ingest.sentry.io/id-junior",
            source: "code",
            sourcePath: "src/instrumentation.ts",
          },
        },
      ],
    });
    const { ui } = createMockUI();

    const result = await resolveInitProjectContext(
      makeContext({ yes: true }),
      "/work/checkout/apps/junior",
      ui
    );

    expect(result.existingProject?.dsn).toBe(
      "https://local@o1.ingest.sentry.io/id-junior"
    );
  });

  test("does not offer improvement when the setup service does not advertise support", async () => {
    detectSentrySetupSpy.mockResolvedValue({
      status: "installed",
      signals: ["init: src/instrumentation.ts"],
    });
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          matchStrength: "exact",
        },
      ],
    });
    const { ui, calls, respond } = createMockUI();
    respond.select("create");

    const result = await resolveInitProjectContext(
      makeContext(),
      "/work/checkout/apps/junior",
      ui,
      { supportsExistingSetupImprovement: false }
    );

    expect(result).toEqual({
      project: "junior-2",
      existingProject: undefined,
    });
    expect(
      calls.filter((call) => call.kind === "select").map((call) => call.options)
    ).toEqual([["create", "existing"]]);
    expect(calls).toContainEqual({
      kind: "log.warn",
      message:
        "The current setup service cannot safely improve this existing Sentry setup. Choose another project or create a new one.",
    });
  });

  test("nests create versus existing under the other-project path", async () => {
    detectSentrySetupSpy.mockResolvedValue({
      status: "installed",
      signals: ["init: src/instrumentation.ts"],
    });
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          orgDisplay: "Acme",
          projectDisplay: "Junior",
          matchStrength: "exact",
        },
      ],
    });
    const { ui, calls, respond } = createMockUI();
    const selectSpy = vi.spyOn(ui, "select");
    respond.select("other");
    respond.select("create");

    const result = await resolveInitProjectContext(
      makeContext(),
      "/work/checkout/apps/junior",
      ui,
      { suggestedProjectName: "junior" }
    );

    expect(result).toEqual({
      project: "junior-2",
      existingProject: undefined,
    });
    expect(
      calls.filter((call) => call.kind === "select").map((call) => call.options)
    ).toEqual([
      ["improve", "other"],
      ["create", "existing"],
    ]);
    expect(selectSpy.mock.calls[1]?.[0].options[0]).toEqual(
      expect.objectContaining({
        label: "+ Create a new Sentry project",
      })
    );
    expect(calls).toContainEqual({
      kind: "log.info",
      message: "New project junior-2 in organization acme",
    });
  });

  test("increments the alternate project slug when the first suffix exists", async () => {
    detectSentrySetupSpy.mockResolvedValue({
      status: "installed",
      signals: ["init: src/instrumentation.ts"],
    });
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          matchStrength: "exact",
        },
      ],
    });
    getProjectSpy.mockImplementation(async (_org, slug) => {
      if (slug === "junior" || slug === "junior-2") {
        return makeProject(slug);
      }
      throw new ApiError("not found", 404);
    });
    const { ui, respond } = createMockUI();
    respond.select("other");
    respond.select("create");

    const result = await resolveInitProjectContext(
      makeContext(),
      "/work/checkout/apps/junior",
      ui,
      { suggestedProjectName: "junior" }
    );

    expect(result.project).toBe("junior-3");
  });

  test("excludes the detected project from the other existing-project list", async () => {
    detectSentrySetupSpy.mockResolvedValue({
      status: "installed",
      signals: ["init: src/instrumentation.ts"],
    });
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          matchStrength: "exact",
        },
      ],
    });
    listProjectsSpy.mockResolvedValue([
      makeProject("junior"),
      makeProject("frontend"),
    ]);
    const { ui, calls, respond } = createMockUI();
    respond.select("other");
    respond.select("existing");
    respond.select("frontend");

    const result = await resolveInitProjectContext(
      makeContext(),
      "/work/checkout/apps/junior",
      ui
    );

    expect(result.existingProject?.projectSlug).toBe("frontend");
    expect(calls).toContainEqual({
      kind: "select",
      message: "Which existing Sentry project should be used?",
      options: ["frontend"],
    });
  });

  test("reuses a concrete project without an improvement prompt for a fresh setup", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          orgDisplay: "Acme",
          projectDisplay: "Junior",
          matchStrength: "exact",
        },
      ],
    });
    const { ui, calls } = createMockUI();

    const result = await resolveInitProjectContext(
      makeContext(),
      "/work/checkout/apps/junior",
      ui
    );

    expect(result.existingProject?.projectSlug).toBe("junior");
    expect(calls.filter((call) => call.kind === "select")).toHaveLength(0);
    expect(calls.some((call) => call.kind === "log.success")).toBe(false);
  });

  test("puts create first when there is no concrete match", async () => {
    const { ui, respond } = createMockUI();
    const selectSpy = vi.spyOn(ui, "select");
    respond.select("create");

    const result = await resolveInitProjectContext(
      makeContext(),
      "/work/checkout/apps/new-app",
      ui
    );

    expect(result).toEqual({
      project: undefined,
      existingProject: undefined,
    });
    expect(selectSpy.mock.calls[0]?.[0].options[0]).toEqual(
      expect.objectContaining({
        value: "create",
        label: "+ Create a new Sentry project",
      })
    );
  });

  test("lists projects only after the existing-project choice", async () => {
    listProjectsSpy.mockResolvedValue([
      makeProject("backend"),
      makeProject("frontend"),
    ]);
    const { ui, respond } = createMockUI();
    respond.select("existing");
    respond.select("frontend");

    const result = await resolveInitProjectContext(
      makeContext(),
      "/work/checkout/apps/new-app",
      ui
    );

    expect(result.existingProject?.projectSlug).toBe("frontend");
    expect(listProjectsSpy).toHaveBeenCalledWith("acme");
  });

  test("confirms an env-backed explicit project with independent canonical evidence", async () => {
    detectSentrySetupSpy.mockResolvedValue({
      status: "installed",
      signals: ["init: src/instrumentation.ts"],
    });
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          matchStrength: "exact",
        },
      ],
    });
    const { ui } = createMockUI();

    const result = await resolveInitProjectContext(
      makeContext({ project: "junior" }),
      "/work/checkout/apps/junior",
      ui,
      { supportsExistingSetupImprovement: true }
    );

    expect(result.existingProject?.projectSlug).toBe("junior");
    expect(result.setupIntent).toBe("improve-existing");
    expect(resolveAllTargetsSpy).toHaveBeenCalled();
  });

  test("reuses a matching local DSN for an explicit existing project", async () => {
    tryGetPrimaryDsnSpy.mockResolvedValueOnce(null);
    detectSentrySetupSpy.mockResolvedValue({
      dsn: "https://local@o1.ingest.sentry.io/id-junior",
      signals: ["dsn: code (src/instrumentation.ts)"],
      status: "installed",
    });
    const { ui } = createMockUI();

    const result = await resolveInitProjectContext(
      makeContext({ project: "junior" }),
      "/work/checkout/apps/junior",
      ui,
      { supportsExistingSetupImprovement: true }
    );

    expect(result.existingProject?.dsn).toBe(
      "https://local@o1.ingest.sentry.io/id-junior"
    );
  });

  test("treats an explicit project with a different local DSN as another project", async () => {
    tryGetPrimaryDsnSpy.mockResolvedValueOnce(null);
    detectSentrySetupSpy.mockResolvedValue({
      dsn: "https://other@o1.ingest.sentry.io/different-id",
      signals: ["dsn: code (src/instrumentation.ts)"],
      status: "installed",
    });
    const { ui } = createMockUI();

    const result = await resolveInitProjectContext(
      makeContext({ project: "junior" }),
      "/work/checkout/apps/junior",
      ui,
      { supportsExistingSetupImprovement: true }
    );

    expect(result.existingProject).toEqual(
      expect.objectContaining({ projectSlug: "junior" })
    );
    expect(result.existingProject?.dsn).toBeUndefined();
    expect(result.setupIntent).toBeUndefined();
  });

  test("improves an existing setup even when project-key lookup is unavailable", async () => {
    tryGetPrimaryDsnSpy.mockResolvedValueOnce(null);
    detectSentrySetupSpy.mockResolvedValue({
      signals: ["init: src/instrumentation.ts"],
      status: "installed",
    });
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          matchStrength: "exact",
        },
      ],
    });
    const { ui } = createMockUI();

    const result = await resolveInitProjectContext(
      makeContext({ project: "junior" }),
      "/work/checkout/apps/junior",
      ui,
      { supportsExistingSetupImprovement: true }
    );

    expect(result.existingProject).toEqual(
      expect.objectContaining({ projectSlug: "junior" })
    );
    expect(result.existingProject?.dsn).toBeUndefined();
    expect(result.setupIntent).toBe("improve-existing");
  });

  test("does not improve an env-backed explicit project without independent evidence", async () => {
    tryGetPrimaryDsnSpy.mockResolvedValueOnce(null);
    detectSentrySetupSpy.mockResolvedValue({
      signals: ["init: src/instrumentation.ts"],
      status: "installed",
    });
    const { ui } = createMockUI();

    const result = await resolveInitProjectContext(
      makeContext({ project: "junior" }),
      "/work/checkout/apps/junior",
      ui,
      { supportsExistingSetupImprovement: true }
    );

    expect(result.existingProject?.projectSlug).toBe("junior");
    expect(result.setupIntent).toBeUndefined();
  });

  test("does not match a self-hosted DSN to a SaaS project with the same ID", async () => {
    tryGetPrimaryDsnSpy.mockResolvedValueOnce(null);
    detectSentrySetupSpy.mockResolvedValue({
      dsn: "https://local@sentry.example.com/id-junior",
      signals: ["dsn: code (src/instrumentation.ts)"],
      status: "installed",
    });
    const { ui } = createMockUI();

    const result = await resolveInitProjectContext(
      makeContext({ project: "junior" }),
      "/work/checkout/apps/junior",
      ui,
      { supportsExistingSetupImprovement: true }
    );

    expect(result.setupIntent).toBeUndefined();
  });

  test("does not mark a missing explicit project as an existing setup improvement", async () => {
    detectSentrySetupSpy.mockResolvedValue({
      status: "installed",
      signals: ["init: src/instrumentation.ts"],
    });
    const { ui } = createMockUI();

    const result = await resolveInitProjectContext(
      makeContext({ project: "brand-new-project" }),
      "/work/checkout/apps/junior",
      ui
    );

    expect(result).toEqual({ project: "brand-new-project" });
    expect(result.setupIntent).toBeUndefined();
  });

  test("ignores fuzzy and ambiguous project matches", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          orgDisplay: "Acme",
          projectDisplay: "Junior",
          matchStrength: "fuzzy",
        },
        {
          org: "acme",
          project: "backend",
          orgDisplay: "Acme",
          projectDisplay: "Backend",
          matchStrength: "exact",
        },
        {
          org: "acme",
          project: "frontend",
          orgDisplay: "Acme",
          projectDisplay: "Frontend",
          matchStrength: "exact",
        },
      ],
    });
    const { ui, respond } = createMockUI();
    respond.select("create");

    const result = await resolveInitProjectContext(
      makeContext(),
      "/work/checkout",
      ui
    );

    expect(result.existingProject).toBeUndefined();
  });

  test("creates non-interactively when no project can be resolved", async () => {
    const { ui, calls } = createMockUI();

    const result = await resolveInitProjectContext(
      makeContext({ yes: true }),
      "/work/checkout/apps/new-app",
      ui
    );

    expect(result).toEqual({
      project: undefined,
      existingProject: undefined,
    });
    expect(calls.filter((call) => call.kind === "select")).toHaveLength(0);
  });

  test("chooses a non-conflicting slug non-interactively after rejecting a mismatch", async () => {
    detectSentrySetupSpy.mockResolvedValue({
      dsn: "https://other@o1.ingest.sentry.io/different-id",
      signals: ["dsn: code (src/instrumentation.ts)"],
      status: "installed",
    });
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "acme",
          project: "junior",
          matchStrength: "exact",
        },
      ],
    });
    const { ui, calls } = createMockUI();

    const result = await resolveInitProjectContext(
      makeContext({ yes: true }),
      "/work/checkout/apps/junior",
      ui
    );

    expect(result).toEqual({
      project: "junior-2",
      existingProject: undefined,
    });
    expect(calls.filter((call) => call.kind === "select")).toHaveLength(0);
  });

  test("propagates cancellation from the project intent prompt", async () => {
    const { ui } = createMockUI();

    await expect(
      resolveInitProjectContext(
        makeContext(),
        "/work/checkout/apps/new-app",
        ui
      )
    ).rejects.toBeInstanceOf(WizardCancelledError);
  });
});
