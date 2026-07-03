import {
  clientKeyFixture,
  mswServer,
  projectFixture,
} from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { afterEach, describe, it, expect } from "vitest";
import createProject from "./create-project.js";

const context = {
  constraints: {
    organizationSlug: null,
    projectSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

describe("create_project", () => {
  afterEach(() => {
    mswServer.resetHandlers();
  });

  it("serializes with the existing default DSN", async () => {
    mswServer.use(
      http.post("*/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/", () =>
        HttpResponse.json({ detail: "unexpected fallback" }, { status: 500 }),
      ),
    );

    const result = await createProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        teamSlug: "the-goats",
        name: "cloudflare-mcp",
        slug: null,
        platform: "node",
        regionUrl: null,
      },
      context,
    );
    expect(result).toMatchInlineSnapshot(`
      "# New Project in **sentry-mcp-evals**

      **ID**: 4509109104082945
      **Slug**: cloudflare-mcp
      **Name**: cloudflare-mcp
      **SENTRY_DSN**: https://d20df0a1ab5031c7f3c7edca9c02814d@o4509106732793856.ingest.us.sentry.io/4509109104082945

      ## Response Notes

      - Please tell the user the project slug and **SENTRY_DSN**.
      - The **SENTRY_DSN** value is used to initialize Sentry SDKs.
      "
    `);
  });

  it("uses an existing non-default DSN when no default key exists", async () => {
    mswServer.use(
      http.get("*/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/", () =>
        HttpResponse.json([
          {
            ...clientKeyFixture,
            name: "Production",
            dsn: {
              public: "https://production@example.com/1",
            },
          },
        ]),
      ),
      http.post("*/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/", () =>
        HttpResponse.json({ detail: "unexpected fallback" }, { status: 500 }),
      ),
    );

    const result = await createProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        teamSlug: "the-goats",
        name: "cloudflare-mcp",
        slug: null,
        platform: "node",
        regionUrl: null,
      },
      context,
    );

    expect(result).toContain(
      "**SENTRY_DSN**: https://production@example.com/1",
    );
  });

  it("creates a fallback default DSN when no key exists", async () => {
    mswServer.use(
      http.get("*/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/", () =>
        HttpResponse.json([]),
      ),
      http.post("*/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/", () =>
        HttpResponse.json({
          ...clientKeyFixture,
          name: "Default",
          dsn: {
            public: "https://fallback@example.com/1",
          },
        }),
      ),
    );

    const result = await createProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        teamSlug: "the-goats",
        name: "cloudflare-mcp",
        slug: null,
        platform: "node",
        regionUrl: null,
      },
      context,
    );

    expect(result).toContain("**SENTRY_DSN**: https://fallback@example.com/1");
  });

  it("passes an optional slug through project creation", async () => {
    let createBody: unknown;
    mswServer.use(
      http.post(
        "*/api/0/teams/sentry-mcp-evals/the-goats/projects/",
        async ({ request }) => {
          createBody = await request.json();
          return HttpResponse.json({
            ...projectFixture,
            name: "My Project",
            slug: "my-project",
            platform: "node",
          });
        },
      ),
      http.get("*/api/0/projects/sentry-mcp-evals/my-project/keys/", () =>
        HttpResponse.json([clientKeyFixture]),
      ),
    );

    const result = await createProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        teamSlug: "the-goats",
        name: "My Project",
        slug: "my-project",
        platform: "node",
        regionUrl: null,
      },
      context,
    );

    expect(createBody).toEqual({
      name: "My Project",
      slug: "my-project",
      platform: "node",
    });
    expect(result).toContain("**Slug**: my-project");
  });

  it("accepts slug but no repository linking parameter", () => {
    expect(createProject.inputSchema).toHaveProperty("slug");
    expect(createProject.inputSchema).not.toHaveProperty("repository");
    expect(createProject.description).not.toContain("repository");
  });
});
