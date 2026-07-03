import { mswServer, teamFixture } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { UserInputError } from "../../errors";
import { prepareToolParams } from "../catalog-runtime/availability";
import { TOP_LEVEL_TOOL_NAMES } from "../surfaces";
import catalogTools from "./index";
import removeTeamFromProject from "./remove-team-from-project";

const context = {
  constraints: {
    organizationSlug: null,
    projectSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

function team(overrides: { id: string; slug: string; name: string }) {
  return {
    ...teamFixture,
    ...overrides,
  };
}

describe("remove_team_from_project", () => {
  afterEach(() => {
    mswServer.resetHandlers();
  });

  it("removes a team and returns remaining teams", async () => {
    const backendTeam = team({
      id: "4509109078196224",
      slug: "backend",
      name: "Backend",
    });
    let listCalls = 0;
    let deleteCalls = 0;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/teams/",
        () => {
          listCalls += 1;
          return HttpResponse.json(
            listCalls === 1 ? [teamFixture, backendTeam] : [backendTeam],
          );
        },
      ),
      http.delete(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/teams/the-goats/",
        () => {
          deleteCalls += 1;
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );

    const result = await removeTeamFromProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        teamSlug: "the-goats",
        regionUrl: null,
      },
      context,
    );

    expect(listCalls).toBe(2);
    expect(deleteCalls).toBe(1);
    expect(result).toMatchInlineSnapshot(`
      "# Team Access Revoked in **sentry-mcp-evals**

      **Project**: cloudflare-mcp
      **Removed Team**: the-goats
      **Result**: Team access was revoked.

      ## Current Project Teams

      - **backend** (ID: 4509109078196224) - Backend

      ## Response Notes

      - Project slug for later requests: \`cloudflare-mcp\`
      - Current team slugs: \`backend\`
      "
    `);
  });

  it("rejects removal when the team is not assigned", async () => {
    let deleteCalls = 0;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/teams/",
        () => HttpResponse.json([teamFixture]),
      ),
      http.delete(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/teams/backend/",
        () => {
          deleteCalls += 1;
          return HttpResponse.json(
            { detail: "unexpected remove" },
            { status: 500 },
          );
        },
      ),
    );

    const promise = removeTeamFromProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        teamSlug: "backend",
        regionUrl: null,
      },
      context,
    );

    await expect(promise).rejects.toBeInstanceOf(UserInputError);
    await expect(promise).rejects.toThrow("not assigned to this project");
    expect(deleteCalls).toBe(0);
  });

  it("rejects removal when the team is the last assigned team", async () => {
    let deleteCalls = 0;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/teams/",
        () => HttpResponse.json([teamFixture]),
      ),
      http.delete(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/teams/the-goats/",
        () => {
          deleteCalls += 1;
          return HttpResponse.json(
            { detail: "unexpected remove" },
            { status: 500 },
          );
        },
      ),
    );

    const promise = removeTeamFromProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        teamSlug: "the-goats",
        regionUrl: null,
      },
      context,
    );

    await expect(promise).rejects.toBeInstanceOf(UserInputError);
    await expect(promise).rejects.toThrow("last team assigned");
    expect(deleteCalls).toBe(0);
  });

  it("preserves mixed-case slugs and injects active constraints", async () => {
    const otherTeam = team({
      id: "100",
      slug: "OtherTeam",
      name: "Other Team",
    });
    const paths: string[] = [];
    let listCalls = 0;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/:organizationSlug/:projectSlug/teams/",
        ({ request }) => {
          paths.push(new URL(request.url).pathname);
          listCalls += 1;
          return HttpResponse.json(
            listCalls === 1
              ? [
                  team({
                    id: "99",
                    slug: "TeamABC",
                    name: "Team ABC",
                  }),
                  otherTeam,
                ]
              : [otherTeam],
          );
        },
      ),
      http.delete(
        "https://sentry.io/api/0/projects/:organizationSlug/:projectSlug/teams/:teamSlug/",
        ({ request }) => {
          paths.push(new URL(request.url).pathname);
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );

    const constrainedContext = {
      ...context,
      constraints: {
        organizationSlug: "MyOrg",
        projectSlug: "MyProject",
      },
    };
    const params = prepareToolParams({
      tool: removeTeamFromProject,
      params: {
        organizationSlug: "OtherOrg",
        projectSlug: "OtherProject",
        teamSlug: " TeamABC ",
        regionUrl: null,
      },
      context: constrainedContext,
    }) as Parameters<typeof removeTeamFromProject.handler>[0];

    const result = await removeTeamFromProject.handler(
      params,
      constrainedContext,
    );

    expect(params).toMatchObject({
      organizationSlug: "MyOrg",
      projectSlug: "MyProject",
      teamSlug: "TeamABC",
    });
    expect(paths).toEqual([
      "/api/0/projects/MyOrg/MyProject/teams/",
      "/api/0/projects/MyOrg/MyProject/teams/TeamABC/",
      "/api/0/projects/MyOrg/MyProject/teams/",
    ]);
    expect(result).toContain("**Removed Team**: TeamABC");
  });

  it("is registered as catalog-only", () => {
    expect(catalogTools.remove_team_from_project).toBe(removeTeamFromProject);
    expect(TOP_LEVEL_TOOL_NAMES).not.toContain("remove_team_from_project");
  });
});
