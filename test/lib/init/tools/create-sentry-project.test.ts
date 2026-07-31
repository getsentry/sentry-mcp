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

let createProjectWithDsnSpy: ReturnType<typeof spyOn>;
let createProjectWithAutoTeamSpy: ReturnType<typeof spyOn>;
let getProjectSpy: ReturnType<typeof spyOn>;
let tryGetPrimaryDsnSpy: ReturnType<typeof spyOn>;
let resolveOrCreateTeamSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
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
  getProjectSpy = vi.spyOn(apiClient, "getProject").mockResolvedValue({
    id: "42",
    slug: "my-app",
    name: "my-app",
    platform: "javascript-react",
    dateCreated: "2026-04-16T00:00:00Z",
  } as any);
  tryGetPrimaryDsnSpy = vi
    .spyOn(apiClient, "tryGetPrimaryDsn")
    .mockResolvedValue("https://abc@o1.ingest.sentry.io/42");
  resolveOrCreateTeamSpy = vi
    .spyOn(resolveTeam, "resolveOrCreateTeam")
    .mockResolvedValue({
      slug: "generated-team",
      source: "auto-created",
    } as any);
});

afterEach(() => {
  createProjectWithDsnSpy.mockRestore();
  createProjectWithAutoTeamSpy.mockRestore();
  getProjectSpy.mockRestore();
  tryGetPrimaryDsnSpy.mockRestore();
  resolveOrCreateTeamSpy.mockRestore();
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
    expect(result.message).toContain("Using existing project");
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
    expect(result.message).toContain("Using existing project");
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

  test("creates a new project with the pre-resolved org and team", async () => {
    getProjectSpy.mockRejectedValueOnce(new ApiError("Not found", 404));

    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: "platform",
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

  test("re-checks for an existing project before creating when the slug is known", async () => {
    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: "platform",
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Using existing project");
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
    expect(resolveOrCreateTeamSpy).not.toHaveBeenCalled();
  });

  test("surfaces lookup failures before creating when a known slug cannot be verified", async () => {
    getProjectSpy.mockRejectedValueOnce(new Error("temporary failure"));

    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: "platform",
      project: undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("temporary failure");
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
  });

  test("returns dry-run placeholder project data", async () => {
    getProjectSpy.mockRejectedValueOnce(new ApiError("Not found", 404));

    const result = await createSentryProject(makePayload(), {
      dryRun: true,
      org: "acme",
      team: "platform",
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
    getProjectSpy.mockRejectedValueOnce(new ApiError("Not found", 404));

    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: undefined,
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(resolveOrCreateTeamSpy).not.toHaveBeenCalled();
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
    expect(createProjectWithAutoTeamSpy).toHaveBeenCalledWith("acme", {
      name: "my-app",
      platform: "javascript-react",
    });
  });

  test("returns clear error with sentry-init guidance when org disables member creation", async () => {
    getProjectSpy.mockRejectedValueOnce(new ApiError("Not found", 404));
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
    getProjectSpy.mockRejectedValueOnce(new ApiError("Not found", 404));
    createProjectWithDsnSpy.mockRejectedValueOnce(
      new ApiError("Forbidden", 403, "No project:write access")
    );

    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: "platform",
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(createProjectWithAutoTeamSpy).toHaveBeenCalledWith("acme", {
      name: "my-app",
      platform: "javascript-react",
    });
  });

  test("suppresses fallback when team was set via --team (isExplicitTeam)", async () => {
    getProjectSpy.mockRejectedValueOnce(new ApiError("Not found", 404));
    createProjectWithDsnSpy.mockRejectedValueOnce(
      new ApiError("Forbidden", 403, "No project:write access")
    );

    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: "backend",
      isExplicitTeam: true,
      project: undefined,
    });

    expect(result.ok).toBe(false);
    expect(createProjectWithAutoTeamSpy).not.toHaveBeenCalled();
  });

  test("does not fall back on team-scoped policy 403", async () => {
    getProjectSpy.mockRejectedValueOnce(new ApiError("Not found", 404));
    createProjectWithDsnSpy.mockRejectedValueOnce(
      new ApiError(
        "Forbidden",
        403,
        "Your organization has disabled this feature for members."
      )
    );

    const result = await createSentryProject(makePayload(), {
      dryRun: false,
      org: "acme",
      team: "platform",
      project: undefined,
    });

    expect(result.ok).toBe(false);
    expect(createProjectWithAutoTeamSpy).not.toHaveBeenCalled();
    expect(result.error).toContain("disabled for members");
  });

  test("surfaces friendly 409 error when fallback project already exists", async () => {
    createProjectWithAutoTeamSpy.mockRejectedValueOnce(
      new ApiError("Conflict", 409, "Slug already in use")
    );
    getProjectSpy.mockRejectedValueOnce(new ApiError("Not found", 404));

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

  test("does not resolve a team for org-scoped dry-run mode", async () => {
    getProjectSpy.mockRejectedValueOnce(new ApiError("Not found", 404));

    const result = await createSentryProject(makePayload(), {
      dryRun: true,
      org: "acme",
      team: undefined,
      project: undefined,
    });

    expect(result.ok).toBe(true);
    expect(resolveOrCreateTeamSpy).not.toHaveBeenCalled();
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
  });
});
