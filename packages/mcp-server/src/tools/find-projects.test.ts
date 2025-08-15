import { describe, it, expect } from "vitest";
import findProjects from "./find-projects.js";
import { getServerContext } from "../test-setup.js";

describe("find_projects", () => {
  it("serializes", async () => {
    const result = await findProjects.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: undefined,
      },
      getServerContext(),
    );
    expect(result).toMatchInlineSnapshot(`
      "# Projects in **sentry-mcp-evals**

      - **cloudflare-mcp**
      "
    `);
  });

  it("filters projects when constrained to specific project", async () => {
    const result = await findProjects.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: undefined,
      },
      {
        ...getServerContext(),
        constraints: {
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "cloudflare-mcp",
        },
      },
    );

    // Should contain note about constraint
    expect(result).toContain(
      "This MCP session is constrained to project **cloudflare-mcp**",
    );
    expect(result).toContain(
      "Project parameters will be automatically provided to tools",
    );

    // Should only show the constrained project
    expect(result).toContain("cloudflare-mcp");
    expect(result).toMatchInlineSnapshot(`
      "# Projects in **sentry-mcp-evals**

      *Note: This MCP session is constrained to project **cloudflare-mcp**. Project parameters will be automatically provided to tools.*

      - **cloudflare-mcp**
      "
    `);
  });

  it("handles constraint to non-existent project", async () => {
    const result = await findProjects.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: undefined,
      },
      {
        ...getServerContext(),
        constraints: {
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "non-existent-project",
        },
      },
    );

    expect(result).toContain(
      "This MCP session is constrained to project **non-existent-project**",
    );
    expect(result).toContain(
      "The constrained project **non-existent-project** was not found in this organization or you don't have access to it",
    );
  });
});
