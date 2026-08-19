import { describe, expect, it } from "vitest";
import type { Skill } from "../../skills";
import { getServerContext } from "../../test-setup";
import type { ServerContext } from "../../types";
import addTeamToProject from "../catalog/add-team-to-project";
import catalogTools from "../catalog";
import createProject from "../catalog/create-project";
import removeTeamFromProject from "../catalog/remove-team-from-project";
import updateProject from "../catalog/update-project";
import {
  getFilteredInputSchema,
  getToolsForMcpRegistration,
  getSearchableTools,
  prepareToolParams,
} from "./availability";

function getProjectManagementContext(
  constraints: Partial<ServerContext["constraints"]> = {},
): ServerContext {
  return getServerContext({
    grantedSkills: new Set<Skill>(["project-management"]),
    constraints,
  });
}

function getSearchableToolNames(context: ServerContext): string[] {
  return getSearchableTools({
    tools: catalogTools,
    context,
    experimentalMode: false,
    useDefaultSurfacePolicy: true,
  }).map(({ tool }) => tool.name);
}

describe("catalog availability", () => {
  it("keeps project-management tools skill-gated and catalog-only", () => {
    const inspectContext = getServerContext({
      grantedSkills: new Set<Skill>(["inspect"]),
    });
    const inspectToolNames = getSearchableToolNames(inspectContext);

    expect(inspectToolNames).not.toEqual(
      expect.arrayContaining([
        "create_project",
        "update_project",
        "add_team_to_project",
        "remove_team_from_project",
      ]),
    );

    const projectManagementContext = getProjectManagementContext();
    const directToolNames = getToolsForMcpRegistration({
      tools: catalogTools,
      context: projectManagementContext,
      experimentalMode: false,
      useDefaultSurfacePolicy: true,
    }).map(({ tool }) => tool.name);

    expect(directToolNames).not.toEqual(
      expect.arrayContaining([
        "create_project",
        "update_project",
        "add_team_to_project",
        "remove_team_from_project",
      ]),
    );
    expect(getSearchableToolNames(projectManagementContext)).toEqual(
      expect.arrayContaining([
        "create_project",
        "update_project",
        "add_team_to_project",
        "remove_team_from_project",
      ]),
    );
  });

  describe("replay capability gating", () => {
    const REPLAY_TOOLS = [
      "get_replay_details",
      "get_replay_activity",
      "get_replay_dom",
    ];

    function getInspectContext(
      constraints: Partial<ServerContext["constraints"]> = {},
    ): ServerContext {
      return getServerContext({
        grantedSkills: new Set<Skill>(["inspect"]),
        constraints,
      });
    }

    it("offers every replay tool when the constrained project has replays", () => {
      const names = getSearchableToolNames(
        getInspectContext({
          organizationSlug: "my-org",
          projectSlug: "my-project",
          projectCapabilities: { replays: true },
        }),
      );

      expect(names).toEqual(expect.arrayContaining(REPLAY_TOOLS));
    });

    it("hides every replay tool when the constrained project has no replays", () => {
      // Advertising a tool that can only fail costs a tool slot and invites a
      // call that returns nothing useful.
      const names = getSearchableToolNames(
        getInspectContext({
          organizationSlug: "my-org",
          projectSlug: "my-project",
          projectCapabilities: { replays: false },
        }),
      );

      for (const toolName of REPLAY_TOOLS) {
        expect(names).not.toContain(toolName);
      }
    });

    it("keeps replay tools available when no project constrains the session", () => {
      // Capabilities are a property of a project. Without one there is
      // nothing to check, and hiding the tools would break unconstrained
      // sessions.
      const names = getSearchableToolNames(getInspectContext());

      expect(names).toEqual(expect.arrayContaining(REPLAY_TOOLS));
    });

    it("keeps every replay tool off the direct surface", () => {
      // They are catalog-only by design: the direct surface is budgeted, and
      // replay review starts from a search or a pasted URL either way.
      const directToolNames = getToolsForMcpRegistration({
        tools: catalogTools,
        context: getInspectContext({
          organizationSlug: "my-org",
          projectSlug: "my-project",
          projectCapabilities: { replays: true },
        }),
        experimentalMode: false,
        useDefaultSurfacePolicy: true,
      }).map(({ tool }) => tool.name);

      for (const toolName of REPLAY_TOOLS) {
        expect(directToolNames).not.toContain(toolName);
      }
    });

    it("hides replay tools from sessions without the inspect skill", () => {
      const names = getSearchableToolNames(
        getProjectManagementContext({
          organizationSlug: "my-org",
          projectSlug: "my-project",
          projectCapabilities: { replays: true },
        }),
      );

      for (const toolName of REPLAY_TOOLS) {
        expect(names).not.toContain(toolName);
      }
    });
  });

  it("hides create_project from project-scoped project-management sessions", () => {
    const context = getProjectManagementContext({
      organizationSlug: "my-org",
      projectSlug: "my-project",
    });

    expect(getSearchableToolNames(context)).toEqual(
      expect.arrayContaining([
        "update_project",
        "add_team_to_project",
        "remove_team_from_project",
      ]),
    );
    expect(getSearchableToolNames(context)).not.toContain("create_project");
  });

  it("injects organization constraints for project creation", () => {
    const context = getProjectManagementContext({
      organizationSlug: "my-org",
    });

    expect(getFilteredInputSchema(createProject, context)).not.toHaveProperty(
      "organizationSlug",
    );
    expect(
      prepareToolParams({
        tool: createProject,
        params: {
          organizationSlug: "other-org",
          teamSlug: "my-team",
          name: "My Project",
          slug: null,
          platform: null,
          regionUrl: null,
        },
        context,
      }),
    ).toMatchObject({
      organizationSlug: "my-org",
      teamSlug: "my-team",
    });
  });

  it("injects project constraints for project update and team access tools", () => {
    const context = getProjectManagementContext({
      organizationSlug: "my-org",
      projectSlug: "my-project",
    });

    for (const tool of [
      updateProject,
      addTeamToProject,
      removeTeamFromProject,
    ]) {
      expect(getFilteredInputSchema(tool, context)).not.toHaveProperty(
        "organizationSlug",
      );
      expect(getFilteredInputSchema(tool, context)).not.toHaveProperty(
        "projectSlug",
      );
    }

    expect(
      prepareToolParams({
        tool: updateProject,
        params: {
          organizationSlug: "other-org",
          projectSlug: "other-project",
          name: "Updated Project",
          slug: null,
          platform: null,
          regionUrl: null,
        },
        context,
      }),
    ).toMatchObject({
      organizationSlug: "my-org",
      projectSlug: "my-project",
      name: "Updated Project",
    });

    for (const tool of [addTeamToProject, removeTeamFromProject]) {
      expect(
        prepareToolParams({
          tool,
          params: {
            organizationSlug: "other-org",
            projectSlug: "other-project",
            teamSlug: "my-team",
            regionUrl: null,
          },
          context,
        }),
      ).toMatchObject({
        organizationSlug: "my-org",
        projectSlug: "my-project",
        teamSlug: "my-team",
      });
    }
  });
});
