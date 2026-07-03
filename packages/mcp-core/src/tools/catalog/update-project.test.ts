import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { afterEach, describe, it, expect } from "vitest";
import { UserInputError } from "../../errors.js";
import updateProject from "./update-project.js";
import { prepareToolParams } from "../catalog-runtime/availability";

const context = {
  constraints: {
    organizationSlug: null,
    projectSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

describe("update_project", () => {
  afterEach(() => {
    mswServer.resetHandlers();
  });

  it("updates name and platform", async () => {
    const result = await updateProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        name: "New Project Name",
        slug: null,
        platform: "python",
        regionUrl: null,
      },
      context,
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

  it("preserves mixed-case slugs in project update requests", async () => {
    const paths: string[] = [];
    let updateBody: unknown;
    mswServer.use(
      http.put("https://sentry.io/api/0/projects/*/*/", async ({ request }) => {
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

    const params = prepareToolParams({
      tool: updateProject,
      params: {
        organizationSlug: " MyOrg ",
        regionUrl: null,
        projectSlug: " OldProject ",
        name: null,
        slug: " NewProject ",
        platform: null,
      },
      context,
    }) as Parameters<typeof updateProject.handler>[0];

    const result = await updateProject.handler(params, context);

    expect(paths).toEqual(["/api/0/projects/MyOrg/OldProject/"]);
    expect(updateBody).toEqual({ slug: "NewProject" });
    expect(result).toContain("**Slug**: NewProject");
  });

  it("rejects calls without metadata fields", async () => {
    await expect(
      updateProject.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "cloudflare-mcp",
          name: null,
          slug: null,
          platform: null,
          regionUrl: null,
        },
        context,
      ),
    ).rejects.toThrow(UserInputError);

    await expect(
      updateProject.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "cloudflare-mcp",
          name: null,
          slug: null,
          platform: null,
          regionUrl: null,
        },
        context,
      ),
    ).rejects.toThrow("At least one project metadata field is required");
  });

  it("rejects slug updates from project-scoped sessions", async () => {
    await expect(
      updateProject.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "cloudflare-mcp",
          name: null,
          slug: "new-project-slug",
          platform: null,
          regionUrl: null,
        },
        {
          ...context,
          constraints: {
            organizationSlug: null,
            projectSlug: "cloudflare-mcp",
          },
        },
      ),
    ).rejects.toThrow(UserInputError);

    await expect(
      updateProject.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "cloudflare-mcp",
          name: null,
          slug: "new-project-slug",
          platform: null,
          regionUrl: null,
        },
        {
          ...context,
          constraints: {
            organizationSlug: null,
            projectSlug: "cloudflare-mcp",
          },
        },
      ),
    ).rejects.toThrow("organization-scoped or unconstrained session");
  });

  it("does not expose team assignment parameters", () => {
    expect(updateProject.inputSchema).not.toHaveProperty("teamSlug");
    expect(updateProject.description).not.toContain("teamSlug");
  });

  it("does not claim idempotency because slug renames invalidate the old slug", () => {
    expect(updateProject.annotations.idempotentHint).toBe(false);
  });
});
