import { mswServer, teamFixture } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { prepareToolParams } from "../catalog-runtime/availability";
import { TOP_LEVEL_TOOL_NAMES } from "../surfaces";
import addTeamToProject from "./add-team-to-project";
import catalogTools from "./index";

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

describe("add_team_to_project", () => {
  afterEach(() => {
    mswServer.resetHandlers();
  });

  it("adds a team and returns assigned teams", async () => {
    const backendTeam = team({
      id: "4509109078196224",
      slug: "backend",
      name: "Backend",
    });
    let listCalls = 0;
    let postCalls = 0;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/teams/",
        () => {
          listCalls += 1;
          return HttpResponse.json(
            listCalls === 1 ? [teamFixture] : [teamFixture, backendTeam],
          );
        },
      ),
      http.post(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/teams/backend/",
        () => {
          postCalls += 1;
          return new HttpResponse(null, { status: 201 });
        },
      ),
    );

    const result = await addTeamToProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        teamSlug: "backend",
        regionUrl: null,
      },
      context,
    );

    expect(listCalls).toBe(2);
    expect(postCalls).toBe(1);
    expect(result).toMatchInlineSnapshot(`
      "# Team Access Granted in **sentry-mcp-evals**

      **Project**: cloudflare-mcp
      **Team**: backend
      **Result**: Team access was granted.

      ## Current Project Teams

      - **the-goats** (ID: 4509106740854784) - the-goats
      - **backend** (ID: 4509109078196224) - Backend

      ## Response Notes

      - Project slug for later requests: \`cloudflare-mcp\`
      - Current team slugs: \`the-goats\`, \`backend\`
      "
    `);
  });

  it("returns current teams without posting when the team is already assigned", async () => {
    const backendTeam = team({
      id: "4509109078196224",
      slug: "backend",
      name: "Backend",
    });
    let postCalls = 0;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/teams/",
        () => HttpResponse.json([teamFixture, backendTeam]),
      ),
      http.post(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/teams/backend/",
        () => {
          postCalls += 1;
          return HttpResponse.json(
            { detail: "unexpected add" },
            { status: 500 },
          );
        },
      ),
    );

    const result = await addTeamToProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        teamSlug: "backend",
        regionUrl: null,
      },
      context,
    );

    expect(postCalls).toBe(0);
    expect(result).toContain("# Team Already Assigned");
    expect(result).toContain(
      "No change was made because the team already had project access.",
    );
    expect(result).toContain("- **backend** (ID: 4509109078196224) - Backend");
  });

  it("preserves mixed-case slugs and injects active constraints", async () => {
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
              ? []
              : [
                  team({
                    id: "99",
                    slug: "TeamABC",
                    name: "Team ABC",
                  }),
                ],
          );
        },
      ),
      http.post(
        "https://sentry.io/api/0/projects/:organizationSlug/:projectSlug/teams/:teamSlug/",
        ({ request }) => {
          paths.push(new URL(request.url).pathname);
          return new HttpResponse(null, { status: 201 });
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
      tool: addTeamToProject,
      params: {
        organizationSlug: "OtherOrg",
        projectSlug: "OtherProject",
        teamSlug: " TeamABC ",
        regionUrl: null,
      },
      context: constrainedContext,
    }) as Parameters<typeof addTeamToProject.handler>[0];

    const result = await addTeamToProject.handler(params, constrainedContext);

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
    expect(result).toContain("**Team**: TeamABC");
  });

  it("is registered as catalog-only", () => {
    expect(catalogTools.add_team_to_project).toBe(addTeamToProject);
    expect(TOP_LEVEL_TOOL_NAMES).not.toContain("add_team_to_project");
  });
});
