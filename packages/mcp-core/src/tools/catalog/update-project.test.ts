import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";
import updateProject from "./update-project.js";
import { prepareToolParams } from "../catalog-runtime/availability";

describe("update_project", () => {
  it("updates name and platform", async () => {
    const result = await updateProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        name: "New Project Name",
        slug: null,
        platform: "python",
        teamSlug: null,
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Updated Project in **sentry-mcp-evals**

      **ID**: 4509109104082945
      **Slug**: cloudflare-mcp
      **Name**: New Project Name
      **Platform**: python

      ## Updates Applied
      - Updated name to "New Project Name"
      - Updated platform to "python"

      ## Response Notes

      - Project slug for later requests: \`cloudflare-mcp\`
      "
    `);
  });

  it("assigns project to new team", async () => {
    const result = await updateProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        name: null,
        slug: null,
        platform: null,
        teamSlug: "backend-team",
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Updated Project in **sentry-mcp-evals**

      **ID**: 4509106749636608
      **Slug**: cloudflare-mcp
      **Name**: cloudflare-mcp
      **Platform**: node

      ## Updates Applied
      - Updated team assignment to "backend-team"

      ## Response Notes

      - Project slug for later requests: \`cloudflare-mcp\`
      - Team assignment: \`backend-team\`
      "
    `);
  });

  it("preserves mixed-case slugs in team and project update requests", async () => {
    const paths: string[] = [];
    let updateBody: unknown;
    mswServer.use(
      http.post("*/api/0/projects/*/*/teams/*/", ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return new HttpResponse(null, { status: 204 });
      }),
      http.put("*/api/0/projects/*/*/", async ({ request }) => {
        paths.push(new URL(request.url).pathname);
        updateBody = await request.json();
        return HttpResponse.json({
          id: "4509109104082945",
          slug: "NewProject",
          name: "New Project",
          platform: "node",
        });
      }),
    );

    const context = {
      constraints: {
        organizationSlug: null,
      },
      accessToken: "access-token",
      userId: "1",
    };
    const params = prepareToolParams({
      tool: updateProject,
      params: {
        organizationSlug: " MyOrg ",
        regionUrl: null,
        projectSlug: " OldProject ",
        name: null,
        slug: " NewProject ",
        platform: null,
        teamSlug: " MyTeam ",
      },
      context,
    }) as Parameters<typeof updateProject.handler>[0];

    const result = await updateProject.handler(params, context);

    expect(paths).toEqual([
      "/api/0/projects/MyOrg/OldProject/teams/MyTeam/",
      "/api/0/projects/MyOrg/OldProject/",
    ]);
    expect(updateBody).toEqual({ slug: "NewProject" });
    expect(result).toContain("**Slug**: NewProject");
    expect(result).toContain('- Updated team assignment to "MyTeam"');
  });
});
