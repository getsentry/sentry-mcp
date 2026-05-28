import { describe, it, expect } from "vitest";
import updateProject from "./update-project.js";

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

      **Team**: backend-team
      "
    `);
  });
});
