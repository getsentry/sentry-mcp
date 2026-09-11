import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/lib/api/projects.js");

// biome-ignore lint/performance/noNamespaceImport: needed for vi.spyOn mocking
import * as projectsApi from "../../src/lib/api/projects.js";
import { MEMBER_PROJECT_CREATION_DISABLED_DETAIL } from "../../src/lib/api-client.js";
import { ApiError } from "../../src/lib/errors.js";
import {
  createProjectWithTeamFallback,
  ProjectCreationApiError,
} from "../../src/lib/project-creation.js";

const projectDetails = {
  project: {
    id: "42",
    slug: "my-project",
    name: "My Project",
    platform: "javascript",
  },
  dsn: "https://public@example.com/42",
  url: "https://acme.sentry.io/projects/my-project/",
};

const autoTeamDetails = {
  ...projectDetails,
  team_slug: "my-project-team",
};

describe("createProjectWithTeamFallback", () => {
  const createProjectWithDsnSpy = vi.mocked(projectsApi.createProjectWithDsn);
  const createProjectWithAutoTeamSpy = vi.mocked(
    projectsApi.createProjectWithAutoTeam
  );

  afterEach(() => {
    vi.resetAllMocks();
  });

  test("uses org-scoped creation when no team is resolved", async () => {
    createProjectWithAutoTeamSpy.mockResolvedValueOnce(autoTeamDetails);

    const result = await createProjectWithTeamFallback({
      orgSlug: "acme",
      name: "My Project",
      platform: "javascript",
    });

    expect(createProjectWithAutoTeamSpy).toHaveBeenCalledWith("acme", {
      name: "My Project",
      platform: "javascript",
    });
    expect(createProjectWithDsnSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      teamSlug: "my-project-team",
      teamSource: "auto-created",
    });
  });

  test("uses the resolved team when team-scoped creation succeeds", async () => {
    createProjectWithDsnSpy.mockResolvedValueOnce(projectDetails);

    const result = await createProjectWithTeamFallback({
      orgSlug: "acme",
      name: "My Project",
      team: { slug: "platform", source: "auto-selected" },
    });

    expect(createProjectWithDsnSpy).toHaveBeenCalledWith("acme", "platform", {
      name: "My Project",
      platform: undefined,
    });
    expect(createProjectWithAutoTeamSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      teamSlug: "platform",
      teamSource: "auto-selected",
    });
  });

  test("falls back to org-scoped creation after an implicit team 403", async () => {
    createProjectWithDsnSpy.mockRejectedValueOnce(
      new ApiError("Forbidden", 403, "You do not have permission")
    );
    createProjectWithAutoTeamSpy.mockResolvedValueOnce(autoTeamDetails);

    const result = await createProjectWithTeamFallback({
      orgSlug: "acme",
      name: "My Project",
      team: { slug: "platform", source: "auto-selected" },
    });

    expect(createProjectWithAutoTeamSpy).toHaveBeenCalledOnce();
    expect(result.teamSource).toBe("auto-created");
  });

  test("does not replace an explicitly requested team after a 403", async () => {
    const error = new ApiError("Forbidden", 403, "You do not have permission");
    createProjectWithDsnSpy.mockRejectedValueOnce(error);

    await expect(
      createProjectWithTeamFallback({
        orgSlug: "acme",
        name: "My Project",
        team: { slug: "platform", source: "explicit" },
      })
    ).rejects.toMatchObject({ cause: error, route: "team" });
    expect(createProjectWithAutoTeamSpy).not.toHaveBeenCalled();
  });

  test("does not replace an interactively selected team after a 403", async () => {
    const error = new ApiError("Forbidden", 403, "You do not have permission");
    createProjectWithDsnSpy.mockRejectedValueOnce(error);

    await expect(
      createProjectWithTeamFallback({
        orgSlug: "acme",
        name: "My Project",
        team: { slug: "platform", source: "selected" },
      })
    ).rejects.toMatchObject({ cause: error, route: "team" });
    expect(createProjectWithAutoTeamSpy).not.toHaveBeenCalled();
  });

  test("identifies stale authorization for an interactively selected Team Admin team", async () => {
    const error = new ApiError(
      "Forbidden",
      403,
      `This organization has ${MEMBER_PROJECT_CREATION_DISABLED_DETAIL} for members`
    );
    createProjectWithDsnSpy.mockRejectedValueOnce(error);

    await expect(
      createProjectWithTeamFallback({
        orgSlug: "acme",
        name: "My Project",
        team: { slug: "platform", source: "selected" },
      })
    ).rejects.toThrow("team:admin");
    expect(createProjectWithAutoTeamSpy).not.toHaveBeenCalled();
  });

  test("identifies the real team-scope failure hidden by the policy detail", async () => {
    const error = new ApiError(
      "Forbidden",
      403,
      `This organization has ${MEMBER_PROJECT_CREATION_DISABLED_DETAIL} for members`
    );
    createProjectWithDsnSpy.mockRejectedValueOnce(error);

    await expect(
      createProjectWithTeamFallback({
        orgSlug: "acme",
        name: "My Project",
        team: { slug: "platform", source: "auto-selected" },
      })
    ).rejects.toThrow("team:admin");
    expect(createProjectWithAutoTeamSpy).not.toHaveBeenCalled();
  });

  test("does not reinterpret a policy 403 for an explicit team", async () => {
    const error = new ApiError(
      "Forbidden",
      403,
      `This organization has ${MEMBER_PROJECT_CREATION_DISABLED_DETAIL} for members`
    );
    createProjectWithDsnSpy.mockRejectedValueOnce(error);

    await expect(
      createProjectWithTeamFallback({
        orgSlug: "acme",
        name: "My Project",
        team: { slug: "platform", source: "explicit" },
      })
    ).rejects.toMatchObject({ cause: error, route: "team" });
    expect(createProjectWithAutoTeamSpy).not.toHaveBeenCalled();
  });

  test("preserves organization-route provenance after a team fallback", async () => {
    createProjectWithDsnSpy.mockRejectedValueOnce(
      new ApiError("Forbidden", 403, "You do not have permission")
    );
    const orgError = new ApiError("Not found", 404, "Endpoint unavailable");
    createProjectWithAutoTeamSpy.mockRejectedValueOnce(orgError);

    const error = await createProjectWithTeamFallback({
      orgSlug: "acme",
      name: "My Project",
      team: { slug: "platform", source: "auto-selected" },
    }).catch((cause) => cause);

    expect(error).toBeInstanceOf(ProjectCreationApiError);
    expect(error).toMatchObject({ cause: orgError, route: "organization" });
  });

  test("preserves org policy errors from the organization fallback", async () => {
    createProjectWithDsnSpy.mockRejectedValueOnce(
      new ApiError("Forbidden", 403, "You do not have permission")
    );
    createProjectWithAutoTeamSpy.mockRejectedValueOnce(
      new ApiError(
        "Forbidden",
        403,
        `This organization has ${MEMBER_PROJECT_CREATION_DISABLED_DETAIL} for members`
      )
    );

    const error = await createProjectWithTeamFallback({
      orgSlug: "acme",
      name: "My Project",
      team: { slug: "platform", source: "auto-selected" },
    }).catch((cause) => cause);

    expect(error).toBeInstanceOf(ProjectCreationApiError);
    expect(error).toMatchObject({
      route: "organization",
      detail: expect.stringContaining(MEMBER_PROJECT_CREATION_DISABLED_DETAIL),
    });
    expect(error.message).not.toContain("team:admin");
  });
});
