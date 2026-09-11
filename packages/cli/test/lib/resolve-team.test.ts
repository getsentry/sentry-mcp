/**
 * Tests for resolveOrCreateTeam error handling. Mocks the teams API so
 * listTeams failures can be exercised without real HTTP calls.
 */

import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/lib/api/teams.js");
vi.mock("../../src/lib/api/organizations.js");

// biome-ignore lint/performance/noNamespaceImport: needed for vi.spyOn mocking
import * as organizationsApi from "../../src/lib/api/organizations.js";
// biome-ignore lint/performance/noNamespaceImport: needed for vi.spyOn mocking
import * as teamsApi from "../../src/lib/api/teams.js";
import { ApiError, ResolutionError } from "../../src/lib/errors.js";
import { resolveOrCreateTeam } from "../../src/lib/resolve-team.js";

describe("resolveOrCreateTeam", () => {
  const listTeamsSpy = vi.mocked(teamsApi.listTeams);
  const createTeamSpy = vi.mocked(teamsApi.createTeam);
  const getOrganizationSpy = vi.mocked(organizationsApi.getOrganization);

  afterEach(() => {
    vi.resetAllMocks();
  });

  test("preserves an explicit team without listing teams", async () => {
    const result = await resolveOrCreateTeam("acme", {
      team: "backend",
      usageHint: "sentry init",
      autoCreateSlug: "my-app",
    });

    expect(result).toEqual({ slug: "backend", source: "explicit" });
    expect(listTeamsSpy).not.toHaveBeenCalled();
  });

  test("uses the team selected by an interactive caller", async () => {
    listTeamsSpy.mockResolvedValue([
      {
        id: "1",
        slug: "contributors",
        name: "Contributors",
        access: ["team:read"],
      },
      {
        id: "2",
        slug: "platform",
        name: "Platform",
        access: ["team:admin"],
      },
      {
        id: "3",
        slug: "web",
        name: "Web",
        access: ["team:admin"],
      },
    ]);

    const result = await resolveOrCreateTeam("acme", {
      usageHint: "sentry init",
      autoCreateSlug: "my-app",
      chooseTeam: async () => ({ kind: "existing", slug: "web" }),
    });

    expect(result).toEqual({ slug: "web", source: "selected" });
    expect(getOrganizationSpy).not.toHaveBeenCalled();
  });

  test("auto-selects one eligible team without an interactive caller", async () => {
    listTeamsSpy.mockResolvedValue([
      {
        id: "2",
        slug: "platform",
        name: "Platform",
        access: ["team:admin"],
      },
    ]);

    const result = await resolveOrCreateTeam("acme", {
      usageHint: "sentry init --yes",
      autoCreateSlug: "my-app",
    });

    expect(result).toEqual({ slug: "platform", source: "auto-selected" });
  });

  test("requires --team for multiple eligible teams without a prompt", async () => {
    listTeamsSpy.mockResolvedValue([
      {
        id: "2",
        slug: "platform",
        name: "Platform",
        access: ["team:admin"],
      },
      {
        id: "3",
        slug: "web",
        name: "Web",
        access: ["team:admin"],
      },
    ]);

    await expect(
      resolveOrCreateTeam("acme", {
        usageHint: "sentry init",
        autoCreateSlug: "my-app",
      })
    ).rejects.toThrow("Choose one explicitly with --team");
  });

  test("creates a new team when the interactive caller chooses create", async () => {
    listTeamsSpy.mockResolvedValue([
      {
        id: "2",
        slug: "platform",
        name: "Platform",
        access: ["team:admin"],
      },
    ]);
    getOrganizationSpy.mockResolvedValue({
      id: "1",
      slug: "acme",
      name: "Acme",
      access: ["project:read"],
      allowMemberProjectCreation: true,
    });

    const result = await resolveOrCreateTeam("acme", {
      usageHint: "sentry init",
      autoCreateSlug: "my-app",
      chooseTeam: async () => ({ kind: "create" }),
    });

    expect(result).toBeUndefined();
    expect(getOrganizationSpy).toHaveBeenCalledWith("acme");
  });

  test("creates a team for a project admin with no eligible team", async () => {
    listTeamsSpy.mockResolvedValue([]);
    getOrganizationSpy.mockResolvedValue({
      id: "1",
      slug: "acme",
      name: "Acme",
      access: ["project:admin", "team:admin"],
      allowMemberProjectCreation: false,
    });
    createTeamSpy.mockResolvedValue({
      id: "2",
      slug: "my-app",
      name: "my-app",
    });

    const result = await resolveOrCreateTeam("acme", {
      usageHint: "sentry init",
      autoCreateSlug: "my-app",
    });

    expect(createTeamSpy).toHaveBeenCalledWith("acme", "my-app");
    expect(result).toEqual({ slug: "my-app", source: "auto-created" });
  });

  test("retries a unique team slug after a conflict", async () => {
    listTeamsSpy.mockResolvedValue([]);
    getOrganizationSpy.mockResolvedValue({
      id: "1",
      slug: "acme",
      name: "Acme",
      access: ["project:admin", "team:admin"],
      allowMemberProjectCreation: false,
    });
    createTeamSpy
      .mockRejectedValueOnce(new ApiError("conflict", 409))
      .mockResolvedValueOnce({
        id: "2",
        slug: "my-app-team",
        name: "my-app-team",
      });

    const result = await resolveOrCreateTeam("acme", {
      usageHint: "sentry init",
      autoCreateSlug: "my-app",
    });

    expect(createTeamSpy).toHaveBeenNthCalledWith(1, "acme", "my-app");
    expect(createTeamSpy).toHaveBeenNthCalledWith(2, "acme", "my-app-team");
    expect(result?.slug).toBe("my-app-team");
  });

  test("surfaces team:admin when restricted team creation returns 403", async () => {
    listTeamsSpy.mockResolvedValue([]);
    getOrganizationSpy.mockResolvedValue({
      id: "1",
      slug: "acme",
      name: "Acme",
      access: ["project:admin", "team:admin"],
      allowMemberProjectCreation: false,
    });
    createTeamSpy.mockRejectedValueOnce(
      new ApiError("Forbidden", 403, "You do not have permission")
    );

    await expect(
      resolveOrCreateTeam("acme", {
        usageHint: "sentry init",
        autoCreateSlug: "my-app",
      })
    ).rejects.toThrow("team:admin");
  });

  test("leaves team undefined for the org-scoped member route", async () => {
    listTeamsSpy.mockResolvedValue([]);
    getOrganizationSpy.mockResolvedValue({
      id: "1",
      slug: "acme",
      name: "Acme",
      access: ["project:read"],
      allowMemberProjectCreation: true,
    });

    const result = await resolveOrCreateTeam("acme", {
      usageHint: "sentry init",
      autoCreateSlug: "my-app",
    });

    expect(result).toBeUndefined();
    expect(createTeamSpy).not.toHaveBeenCalled();
  });

  test("prefers atomic org-scoped creation when member creation is allowed", async () => {
    listTeamsSpy.mockResolvedValue([]);
    getOrganizationSpy.mockResolvedValue({
      id: "1",
      slug: "acme",
      name: "Acme",
      access: ["project:admin"],
      allowMemberProjectCreation: true,
    });

    const result = await resolveOrCreateTeam("acme", {
      usageHint: "sentry init",
      autoCreateSlug: "my-app",
    });

    expect(result).toBeUndefined();
    expect(createTeamSpy).not.toHaveBeenCalled();
  });

  test("prefers org-scoped creation for an org manager", async () => {
    listTeamsSpy.mockResolvedValue([]);
    getOrganizationSpy.mockResolvedValue({
      id: "1",
      slug: "acme",
      name: "Acme",
      access: ["org:write", "project:admin"],
      allowMemberProjectCreation: false,
    });

    const result = await resolveOrCreateTeam("acme", {
      usageHint: "sentry init",
      autoCreateSlug: "my-app",
    });

    expect(result).toBeUndefined();
    expect(createTeamSpy).not.toHaveBeenCalled();
  });

  test("does not create an unusable team when OAuth lacks team:admin", async () => {
    listTeamsSpy.mockResolvedValue([]);
    getOrganizationSpy.mockResolvedValue({
      id: "1",
      slug: "acme",
      name: "Acme",
      access: ["project:admin"],
      allowMemberProjectCreation: false,
    });

    await expect(
      resolveOrCreateTeam("acme", {
        usageHint: "sentry init",
        autoCreateSlug: "my-app",
      })
    ).rejects.toThrow("team:admin");
    expect(createTeamSpy).not.toHaveBeenCalled();
  });

  test("uses the org-scoped route when teams cannot be listed", async () => {
    listTeamsSpy.mockRejectedValueOnce(new ApiError("Forbidden", 403));

    const result = await resolveOrCreateTeam("acme", {
      usageHint: "sentry init",
      autoCreateSlug: "my-app",
    });

    expect(result).toBeUndefined();
  });

  test("re-throws the original ApiError when listTeams returns 401", async () => {
    // member-disabled-over-limit and other 401s must keep their enriched detail
    // instead of being flattened into a generic ResolutionError.
    const apiError = new ApiError(
      "Failed to list teams",
      401,
      "Your account is disabled in this organization because it is over its member limit."
    );
    listTeamsSpy.mockRejectedValueOnce(apiError);

    const error = await resolveOrCreateTeam("chisme", {
      usageHint: "sentry init",
    }).catch((e) => e);

    expect(error).toBe(apiError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(ResolutionError);
    expect(error.status).toBe(401);
    expect(error.detail).toContain("over its member limit");
  });
});
