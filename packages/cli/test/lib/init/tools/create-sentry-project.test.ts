import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../../src/lib/api-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/lib/api-client.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

vi.mock("../../../../src/lib/scope-recovery.js", () => ({
  captureOAuthScopeRecoveryGate: vi.fn(),
}));

// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as apiClient from "../../../../src/lib/api-client.js";
import { ApiError } from "../../../../src/lib/errors.js";
import {
  createSentryProject,
  createSentryProjectTool,
} from "../../../../src/lib/init/tools/create-sentry-project.js";
import type {
  CreateSentryProjectPayload,
  EnsureSentryProjectPayload,
} from "../../../../src/lib/init/types.js";
// biome-ignore lint/performance/noNamespaceImport: mocked at the module boundary
import * as scopeRecovery from "../../../../src/lib/scope-recovery.js";

vi.mock("../../../../src/lib/resolve-team.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../../src/lib/resolve-team.js")
    >();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as resolveTeam from "../../../../src/lib/resolve-team.js";

function makePayload(
  overrides?: Partial<CreateSentryProjectPayload["params"]>,
  operation: CreateSentryProjectPayload["operation"] = "create-sentry-project"
): CreateSentryProjectPayload {
  return {
    type: "tool",
    operation,
    cwd: "/tmp/test",
    params: {
      name: "my-app",
      platform: "javascript-react",
      ...overrides,
    },
  };
}

function makeEnsurePayload(
  overrides?: Partial<EnsureSentryProjectPayload["params"]>
): EnsureSentryProjectPayload {
  return {
    ...makePayload(overrides),
    operation: "ensure-sentry-project",
  };
}

const sampleAutoTeamResult = {
  project: {
    id: "42",
    slug: "my-app",
    name: "my-app",
    platform: "javascript-react",
    dateCreated: "2026-04-16T00:00:00Z",
  } as any,
  dsn: "https://abc@o1.ingest.sentry.io/42",
  url: "https://sentry.io/settings/acme/projects/my-app/",
  team_slug: "team-testuser",
};

const autoSelectedTeam = {
  slug: "platform",
  source: "auto-selected" as const,
};

let createProjectWithDsnSpy: ReturnType<typeof spyOn>;
let createProjectWithAutoTeamSpy: ReturnType<typeof spyOn>;
let resolveOrCreateTeamSpy: ReturnType<typeof spyOn>;
let shouldDelegateScopeRecovery: ReturnType<typeof vi.fn>;

beforeEach(() => {
  shouldDelegateScopeRecovery = vi.fn().mockResolvedValue(false);
  vi.mocked(scopeRecovery.captureOAuthScopeRecoveryGate).mockReturnValue({
    shouldDelegate: shouldDelegateScopeRecovery,
  });
  createProjectWithDsnSpy = vi
    .spyOn(apiClient, "createProjectWithDsn")
    .mockResolvedValue({
      project: {
        id: "42",
        slug: "my-app",
        name: "my-app",
        platform: "javascript-react",
        dateCreated: "2026-04-16T00:00:00Z",
      } as any,
      dsn: "https://abc@o1.ingest.sentry.io/42",
      url: "https://sentry.io/settings/acme/projects/my-app/",
    });
  createProjectWithAutoTeamSpy = vi
    .spyOn(apiClient, "createProjectWithAutoTeam")
    .mockResolvedValue(sampleAutoTeamResult);
  resolveOrCreateTeamSpy = vi
    .spyOn(resolveTeam, "resolveOrCreateTeam")
    .mockImplementation(async (_org, options) =>
      options.team ? { slug: options.team, source: "explicit" } : undefined
    );
});

afterEach(() => {
  createProjectWithDsnSpy.mockRestore();
  createProjectWithAutoTeamSpy.mockRestore();
  resolveOrCreateTeamSpy.mockRestore();
  vi.mocked(scopeRecovery.captureOAuthScopeRecoveryGate).mockReset();
});

describe("createSentryProject", () => {
  test("returns the pre-resolved existing project without creating", async () => {
    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: undefined,
      project: "my-app",
      existingProject: {
        orgSlug: "acme",
        projectSlug: "my-app",
        projectId: "42",
        dsn: "https://abc@o1.ingest.sentry.io/42",
        url: "https://sentry.io/settings/acme/projects/my-app/",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({ ensuredVia: "existing" })
    );
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
    expect(resolveOrCreateTeamSpy).not.toHaveBeenCalled();
  });

  test("accepts the legacy ensure-sentry-project alias", async () => {
    const result = await createSentryProject(makeEnsurePayload(), {
      dryRun: false,
      org: "acme",
      team: undefined,
      project: "my-app",
      existingProject: {
        orgSlug: "acme",
        projectSlug: "my-app",
        projectId: "42",
        dsn: "https://abc@o1.ingest.sentry.io/42",
        url: "https://sentry.io/settings/acme/projects/my-app/",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({ ensuredVia: "existing" })
    );
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
  });

  test("fails early when a newly selected existing project has no readable DSN", async () => {
    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: undefined,
      project: "my-app",
      existingProject: {
        orgSlug: "acme",
        projectSlug: "my-app",
        projectId: "42",
        url: "https://sentry.io/settings/acme/projects/my-app/",
      },
    });

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Could not obtain a DSN"),
    });
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
  });

  test("allows an existing setup improvement to preserve its current DSN source", async () => {
    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: undefined,
      project: "my-app",
      setupIntent: "improve-existing",
      existingProject: {
        orgSlug: "acme",
        projectSlug: "my-app",
        projectId: "42",
        url: "https://sentry.io/settings/acme/projects/my-app/",
      },
    });

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        ensuredVia: "existing",
        projectSlug: "my-app",
      }),
    });
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
  });

  test("returns error when project name produces an empty slug", async () => {
    const result = await createSentryProject(makePayload({ name: "---" }), {
      dryRun: false,
      org: "acme",
      team: undefined,
      project: undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("produces an empty slug");
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
  });

  test("creates a new project with the explicit preflight team", async () => {
    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: { slug: "platform", source: "explicit" },
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(createProjectWithDsnSpy).toHaveBeenCalledWith(
      "acme",
      "platform",
      expect.objectContaining({
        name: "my-app",
        platform: "javascript-react",
      })
    );
  });

  test("does not silently reuse a project after creation was selected", async () => {
    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: { slug: "platform", source: "explicit" },
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(createProjectWithDsnSpy).toHaveBeenCalledOnce();
    expect(apiClient.getProject).not.toHaveBeenCalled();
  });

  test("returns dry-run placeholder project data", async () => {
    const result = await createSentryProject(makePayload(), {
      dryRun: true,
      org: "acme",
      team: { slug: "platform", source: "explicit" },
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        orgSlug: "acme",
        projectId: "(dry-run)",
      })
    );
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
  });

  test("uses org-scoped auto-team creation when preflight did not resolve a team", async () => {
    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: undefined,
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(resolveOrCreateTeamSpy).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ autoCreateSlug: "my-app" })
    );
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
    expect(createProjectWithAutoTeamSpy).toHaveBeenCalledWith("acme", {
      name: "my-app",
      platform: "javascript-react",
    });
  });

  test("returns clear error with sentry-init guidance when org disables member creation", async () => {
    createProjectWithAutoTeamSpy.mockRejectedValueOnce(
      new ApiError(
        "Failed to create project: 403 Forbidden",
        403,
        "Your organization has disabled this feature for members.",
        undefined,
        true
      )
    );

    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: undefined,
      project: undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("disabled for members");
    expect(result.error).toContain("sentry init acme/");
    expect(result.error).not.toContain("Re-authenticate");
  });

  test("tool describe uses payload.detail when provided", () => {
    const payload = { ...makePayload(), detail: "Setting up my-app..." };
    expect(createSentryProjectTool.describe(payload)).toBe(
      "Setting up my-app..."
    );
  });

  test("tool describe falls back to project name and platform", () => {
    expect(createSentryProjectTool.describe(makePayload())).toContain("my-app");
  });

  test("falls back to org-scoped endpoint on 403 from team-based creation", async () => {
    resolveOrCreateTeamSpy.mockResolvedValueOnce(autoSelectedTeam);
    createProjectWithDsnSpy.mockRejectedValueOnce(
      new ApiError("Forbidden", 403, "No project:write access")
    );

    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: undefined,
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(createProjectWithAutoTeamSpy).toHaveBeenCalledWith("acme", {
      name: "my-app",
      platform: "javascript-react",
    });
  });

  test("retries an invalid platform on the concrete fallback route", async () => {
    resolveOrCreateTeamSpy.mockResolvedValueOnce(autoSelectedTeam);
    createProjectWithDsnSpy.mockRejectedValueOnce(
      new ApiError("Forbidden", 403, "No project:write access")
    );
    createProjectWithAutoTeamSpy
      .mockRejectedValueOnce(
        new ApiError("Bad request", 400, "Invalid platform")
      )
      .mockResolvedValueOnce(sampleAutoTeamResult);

    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: undefined,
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(createProjectWithDsnSpy).toHaveBeenCalledOnce();
    expect(createProjectWithAutoTeamSpy).toHaveBeenNthCalledWith(1, "acme", {
      name: "my-app",
      platform: "javascript-react",
    });
    expect(createProjectWithAutoTeamSpy).toHaveBeenNthCalledWith(2, "acme", {
      name: "my-app",
      platform: undefined,
    });
  });

  test("suppresses fallback for an explicitly resolved team", async () => {
    createProjectWithDsnSpy.mockRejectedValueOnce(
      new ApiError("Forbidden", 403, "You do not have permission")
    );

    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: { slug: "backend", source: "explicit" },
      project: undefined,
    });

    expect(result.ok).toBe(false);
    expect(createProjectWithAutoTeamSpy).not.toHaveBeenCalled();
  });

  test("identifies the team scope hidden by a team-scoped policy 403", async () => {
    shouldDelegateScopeRecovery.mockResolvedValueOnce(true);
    resolveOrCreateTeamSpy.mockResolvedValueOnce(autoSelectedTeam);
    createProjectWithDsnSpy.mockRejectedValueOnce(
      new ApiError(
        "Forbidden",
        403,
        "Your organization has disabled this feature for members."
      )
    );

    await expect(
      createSentryProject(makePayload(), {
        dryRun: false,
        org: "acme",
        team: undefined,
        project: undefined,
      })
    ).rejects.toMatchObject({
      status: 403,
      detail: expect.stringContaining("team:admin"),
    });
    expect(createProjectWithAutoTeamSpy).not.toHaveBeenCalled();
  });

  test("surfaces friendly 409 error when fallback project already exists", async () => {
    createProjectWithAutoTeamSpy.mockRejectedValueOnce(
      new ApiError("Conflict", 409, "Slug already in use")
    );

    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: undefined,
      project: undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("already exists");
  });

  // ── dry-run ──────────────────────────────────────────────────────────────

  test("resolves team policy without mutating during dry-run", async () => {
    const result = await createSentryProject(makePayload(), {
      dryRun: true,
      org: "acme",
      team: undefined,
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(resolveOrCreateTeamSpy).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ dryRun: true })
    );
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
  });
});
