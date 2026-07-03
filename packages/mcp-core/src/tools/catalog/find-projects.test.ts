import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";
import findProjects from "./find-projects.js";
import { prepareToolParams } from "../catalog-runtime/availability";
import { getServerContext } from "../../test-setup.js";

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

  it("preserves mixed-case organization slug in the API path", async () => {
    const context = getServerContext();

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/*/projects/",
        ({ request }) => {
          expect(new URL(request.url).pathname).toBe(
            "/api/0/organizations/MyOrg/projects/",
          );
          return HttpResponse.json([
            {
              id: "1",
              slug: "MyProject",
              name: "My Project",
            },
          ]);
        },
      ),
    );

    const params = prepareToolParams({
      tool: findProjects,
      params: {
        organizationSlug: " MyOrg ",
        regionUrl: null,
        query: null,
      },
      context,
    }) as Parameters<typeof findProjects.handler>[0];

    const result = await findProjects.handler(params, context);

    expect(result).toContain("# Projects in **MyOrg**");
    expect(result).toContain("- **MyProject**");
  });
});
