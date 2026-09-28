import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";
import {
  assertStructuredOnlyResult,
  getStructuredContent,
} from "../../test-utils/structured-content.js";
import findProjects, { findProjectsOutputSchema } from "./find-projects.js";
import { prepareToolParams } from "../catalog-runtime/availability";
import { getServerContext } from "../../test-setup.js";

describe("find_projects", () => {
  it("serializes", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/projects/",
        ({ request }) => {
          expect(new URL(request.url).searchParams.get("per_page")).toBe("26");
          return HttpResponse.json([
            {
              id: "1",
              slug: "cloudflare-mcp",
              name: "Cloudflare MCP",
            },
          ]);
        },
      ),
    );

    const result = await findProjects.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        query: null,
      },
      getServerContext(),
    );

    assertStructuredOnlyResult(result);
    const structuredContent = getStructuredContent(result);
    expect(findProjectsOutputSchema.parse(structuredContent)).toEqual(
      structuredContent,
    );
    expect(structuredContent).toMatchInlineSnapshot(`
      {
        "hasMore": false,
        "projects": [
          {
            "slug": "cloudflare-mcp",
          },
        ],
      }
    `);
  });

  it("reports more results and returns only the first 25 projects", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/projects/",
        ({ request }) => {
          expect(new URL(request.url).searchParams.get("per_page")).toBe("26");
          return HttpResponse.json(
            Array.from({ length: 26 }, (_, index) => ({
              id: String(index + 1),
              slug: `project-${String(index + 1).padStart(2, "0")}`,
              name: `Project ${index + 1}`,
            })),
          );
        },
      ),
    );

    const result = await findProjects.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        query: null,
      },
      getServerContext(),
    );

    assertStructuredOnlyResult(result);
    expect(getStructuredContent(result)).toEqual({
      projects: Array.from({ length: 25 }, (_, index) => ({
        slug: `project-${String(index + 1).padStart(2, "0")}`,
      })),
      hasMore: true,
    });
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

    assertStructuredOnlyResult(result);
    expect(getStructuredContent(result)).toEqual({
      projects: [{ slug: "MyProject" }],
      hasMore: false,
    });
  });
});
