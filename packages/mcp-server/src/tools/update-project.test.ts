import { describe, it, expect } from "vitest";
import updateProject from "./update-project.js";

describe("update_project", () => {
  it("updates name and platform", async () => {
    const result = await updateProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        name: "New Project Name",
        slug: undefined,
        platform: "python",
        teamSlug: undefined,
        regionUrl: undefined,
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
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

      # Using this information

      - The project is now accessible at slug: \`cloudflare-mcp\`
      "
    `);
  });

  it("assigns project to new team", async () => {
    const result = await updateProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        name: undefined,
        slug: undefined,
        platform: undefined,
        teamSlug: "backend-team",
        regionUrl: undefined,
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
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

      # Using this information

      - The project is now accessible at slug: \`cloudflare-mcp\`
      - The project is now assigned to the \`backend-team\` team
      "
    `);
  });
  it("returns json", async () => {
    const result = await updateProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        name: undefined,
        slug: undefined,
        platform: undefined,
        teamSlug: "backend-team",
        regionUrl: undefined,
        responseType: "json",
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );
    expect(result).toMatchObject({
      organizationSlug: "sentry-mcp-evals",
      project: {
        id: "4509106749636608",
        slug: "cloudflare-mcp",
        name: "cloudflare-mcp",
      },
    });
  });
});
