import { describe, it, expect } from "vitest";
import findProjects from "./find-projects.js";

describe("find_projects", () => {
  it("serializes", async () => {
    const result = await findProjects.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: undefined,
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Projects in **sentry-mcp-evals**

      - **cloudflare-mcp**
      "
    `);
  });
});
