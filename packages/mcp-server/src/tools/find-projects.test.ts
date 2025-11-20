import { describe, it, expect } from "vitest";
import findProjects from "./find-projects.js";
import { getServerContext } from "../test-setup.js";

describe("find_projects", () => {
  it("serializes", async () => {
    const result = await findProjects.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        query: null,
      },
      getServerContext(),
    );
    expect(result).toMatchInlineSnapshot(`
      "# Projects in **sentry-mcp-evals**

      - **cloudflare-mcp**
      "
    `);
  });
});
