import {
  clientKeyFixture,
  mswServer,
  projectFixture,
  teamFixture,
} from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { afterEach, describe, it, expect } from "vitest";
import createProject, { selectDefaultTeam } from "./create-project.js";
import { UserInputError } from "../../errors.js";

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
      http.post(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
        () =>
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
        repository: null,
      },
      context,
    );
    expect(result).toMatchInlineSnapshot(`
      "# New Project in **sentry-mcp-evals**

      **ID**: 4509109104082945
      **Slug**: cloudflare-mcp
      **Name**: cloudflare-mcp
      **Team**: the-goats
      **SENTRY_DSN**: https://d20df0a1ab5031c7f3c7edca9c02814d@o4509106732793856.ingest.us.sentry.io/4509109104082945

      ## Response Notes

      - Please tell the user the project slug and **SENTRY_DSN**.
      - No additional DSN creation step is needed.
      - The **SENTRY_DSN** value is used to initialize Sentry SDKs.
      "
    `);
  });

  it("uses an existing non-default DSN when no default key exists", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
        () =>
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
      http.post(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
        () =>
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
        repository: null,
      },
      context,
    );

    expect(result).toContain(
      "**SENTRY_DSN**: https://production@example.com/1",
    );
  });

  it("creates a fallback default DSN when only inactive keys exist", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
        () =>
          HttpResponse.json([
            {
              ...clientKeyFixture,
              isActive: false,
              dsn: {
                public: "https://inactive@example.com/1",
              },
            },
          ]),
      ),
      http.post(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
        () =>
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
        repository: null,
      },
      context,
    );

    expect(result).toContain("**SENTRY_DSN**: https://fallback@example.com/1");
    expect(result).not.toContain("https://inactive@example.com/1");
  });

  it("creates a fallback default DSN when no key exists", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
        () => HttpResponse.json([]),
      ),
      http.post(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
        () =>
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
        repository: null,
      },
      context,
    );

    expect(result).toContain("**SENTRY_DSN**: https://fallback@example.com/1");
  });

  it("creates a fallback default DSN when key listing fails after creation", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
        () => HttpResponse.json({ detail: "lookup failed" }, { status: 500 }),
      ),
      http.post(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
        () =>
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
        repository: null,
      },
      context,
    );

    expect(result).toContain("**SENTRY_DSN**: https://fallback@example.com/1");
    expect(result).toContain("No additional DSN creation step is needed");
  });

  it("returns project details when DSN setup fails after creation", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
        () => HttpResponse.json({ detail: "lookup failed" }, { status: 500 }),
      ),
      http.post(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
        () => HttpResponse.json({ detail: "create failed" }, { status: 500 }),
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
        repository: null,
      },
      context,
    );

    expect(result).toContain("**Slug**: cloudflare-mcp");
    expect(result).toContain("**SENTRY_DSN**: unavailable");
    expect(result).toContain(
      "Project creation succeeded, but SENTRY_DSN could not be retrieved or created",
    );
    expect(result).toContain(
      "Use create_dsn for this project before initializing Sentry SDKs",
    );
    expect(result).not.toContain("No additional DSN creation step is needed");
  });

  it("passes an optional slug through project creation", async () => {
    let createBody: unknown;
    mswServer.use(
      http.post(
        "https://sentry.io/api/0/teams/sentry-mcp-evals/the-goats/projects/",
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
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/my-project/keys/",
        () => HttpResponse.json([clientKeyFixture]),
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
        repository: null,
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

  it("links a matching repository when provided", async () => {
    const result = await createProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        teamSlug: "the-goats",
        name: "cloudflare-mcp",
        slug: null,
        platform: "node",
        regionUrl: null,
        repository: "getsentry/sentry",
      },
      context,
    );

    expect(result).toContain("**Repository**: getsentry/sentry (linked)");
    expect(result).toContain("**Code Mapping**: `/` -> `/`");
    expect(result).not.toContain("Repository Link ID");
  });

  it("prefers an exact repository name over suffix matches", async () => {
    let mappingBody: unknown;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/repos/",
        ({ request }) => {
          expect(new URL(request.url).searchParams.get("query")).toBeNull();
          return HttpResponse.json([
            {
              id: "101",
              name: "mirror/getsentry/sentry",
              provider: { id: "integrations:github", name: "GitHub" },
              status: "active",
            },
            {
              id: "102",
              name: "getsentry/sentry",
              provider: { id: "integrations:github", name: "GitHub" },
              status: "active",
            },
          ]);
        },
      ),
      http.post(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/code-mappings/bulk/",
        async ({ request }) => {
          mappingBody = await request.json();
          return HttpResponse.json({
            created: 1,
            updated: 0,
            errors: 0,
            mappings: [{ stackRoot: "", sourceRoot: "", status: "created" }],
          });
        },
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
        repository: "getsentry/sentry",
      },
      context,
    );

    expect(mappingBody).toMatchObject({ repository: "getsentry/sentry" });
    expect(result).toContain("**Repository**: getsentry/sentry (linked)");
  });

  it("returns project setup details when repository linking fails after creation", async () => {
    mswServer.use(
      http.post(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/code-mappings/bulk/",
        () => HttpResponse.json({ detail: "link failed" }, { status: 500 }),
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
        repository: "getsentry/sentry",
      },
      context,
    );

    expect(result).toContain("**Slug**: cloudflare-mcp");
    expect(result).toContain("**SENTRY_DSN**:");
    expect(result).toContain(
      "Found getsentry/sentry but failed to link it to the project",
    );
  });

  it("rejects an unknown repository before creating the project", async () => {
    let createCalls = 0;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/repos/",
        ({ request }) => {
          expect(new URL(request.url).searchParams.get("query")).toBeNull();
          return HttpResponse.json([]);
        },
      ),
      http.post(
        "https://sentry.io/api/0/teams/sentry-mcp-evals/the-goats/projects/",
        () => {
          createCalls += 1;
          return HttpResponse.json(
            { detail: "unexpected create" },
            { status: 500 },
          );
        },
      ),
    );

    await expect(
      createProject.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          teamSlug: "the-goats",
          name: "cloudflare-mcp",
          slug: null,
          platform: "node",
          regionUrl: null,
          repository: "missing/repo",
        },
        context,
      ),
    ).rejects.toThrow('Could not find repository "missing/repo"');
    expect(createCalls).toBe(0);
  });

  it("rejects an ambiguous repository before creating the project", async () => {
    let createCalls = 0;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/repos/",
        ({ request }) => {
          expect(new URL(request.url).searchParams.get("query")).toBeNull();
          return HttpResponse.json([
            {
              id: "101",
              name: "getsentry/sentry",
              provider: { id: "integrations:github", name: "GitHub" },
              status: "active",
            },
            {
              id: "102",
              name: "other/sentry",
              provider: { id: "integrations:github", name: "GitHub" },
              status: "active",
            },
          ]);
        },
      ),
      http.post(
        "https://sentry.io/api/0/teams/sentry-mcp-evals/the-goats/projects/",
        () => {
          createCalls += 1;
          return HttpResponse.json(
            { detail: "unexpected create" },
            { status: 500 },
          );
        },
      ),
    );

    await expect(
      createProject.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          teamSlug: "the-goats",
          name: "cloudflare-mcp",
          slug: null,
          platform: "node",
          regionUrl: null,
          repository: "sentry",
        },
        context,
      ),
    ).rejects.toThrow('Repository "sentry" matched multiple repositories');
    expect(createCalls).toBe(0);
  });

  it("accepts slug and repository linking parameters", () => {
    expect(createProject.inputSchema).toHaveProperty("slug");
    expect(createProject.inputSchema).toHaveProperty("repository");
    expect(createProject.inputSchema).toHaveProperty("teamSlug");
    expect(createProject.description).toContain("repository");
    expect(createProject.description).toContain("teamSlug is optional");
  });

  it("infers a default team when teamSlug is omitted", async () => {
    let createPath = "";
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/teams/",
        () => HttpResponse.json([teamFixture]),
      ),
      http.post(
        "https://sentry.io/api/0/teams/sentry-mcp-evals/the-goats/projects/",
        ({ request }) => {
          createPath = new URL(request.url).pathname;
          return HttpResponse.json(projectFixture);
        },
      ),
    );

    const result = await createProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        teamSlug: null,
        name: "cloudflare-mcp",
        slug: null,
        platform: "node",
        regionUrl: null,
        repository: null,
      },
      context,
    );

    expect(createPath).toBe(
      "/api/0/teams/sentry-mcp-evals/the-goats/projects/",
    );
    expect(result).toContain("**Team**: the-goats (default)");
    expect(result).toContain(
      "teamSlug was omitted, so the project was created on default team `the-goats`",
    );
  });

  it("prefers member teams and earliest dateCreated when inferring", async () => {
    let createPath = "";
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/teams/",
        () =>
          HttpResponse.json([
            {
              ...teamFixture,
              id: "1",
              slug: "backend",
              name: "backend",
              isMember: false,
              hasAccess: true,
              dateCreated: "2020-01-01T00:00:00.000Z",
            },
            {
              ...teamFixture,
              id: "2",
              slug: "frontend",
              name: "frontend",
              isMember: true,
              hasAccess: true,
              dateCreated: "2024-01-01T00:00:00.000Z",
            },
            {
              ...teamFixture,
              id: "3",
              slug: "platform",
              name: "platform",
              isMember: true,
              hasAccess: true,
              dateCreated: "2021-01-01T00:00:00.000Z",
            },
          ]),
      ),
      http.post(
        "https://sentry.io/api/0/teams/sentry-mcp-evals/platform/projects/",
        ({ request }) => {
          createPath = new URL(request.url).pathname;
          return HttpResponse.json({
            ...projectFixture,
            slug: "cloudflare-mcp",
          });
        },
      ),
      http.get(
        "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
        () => HttpResponse.json([clientKeyFixture]),
      ),
    );

    const result = await createProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        teamSlug: null,
        name: "cloudflare-mcp",
        slug: null,
        platform: "node",
        regionUrl: null,
        repository: null,
      },
      context,
    );

    expect(createPath).toBe(
      "/api/0/teams/sentry-mcp-evals/platform/projects/",
    );
    expect(result).toContain("**Team**: platform (default)");
  });

  it("keeps an explicit teamSlug without listing teams", async () => {
    let listedTeams = false;
    let createPath = "";
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/teams/",
        () => {
          listedTeams = true;
          return HttpResponse.json([teamFixture]);
        },
      ),
      http.post(
        "https://sentry.io/api/0/teams/sentry-mcp-evals/the-goats/projects/",
        ({ request }) => {
          createPath = new URL(request.url).pathname;
          return HttpResponse.json(projectFixture);
        },
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
        repository: null,
      },
      context,
    );

    expect(listedTeams).toBe(false);
    expect(createPath).toBe(
      "/api/0/teams/sentry-mcp-evals/the-goats/projects/",
    );
    expect(result).toContain("**Team**: the-goats");
    expect(result).not.toContain("(default)");
  });

  it("rejects omitted teamSlug when the organization has no teams", async () => {
    let createCalls = 0;
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/teams/",
        () => HttpResponse.json([]),
      ),
      http.post(
        "https://sentry.io/api/0/teams/sentry-mcp-evals/the-goats/projects/",
        () => {
          createCalls += 1;
          return HttpResponse.json(
            { detail: "unexpected create" },
            { status: 500 },
          );
        },
      ),
    );

    await expect(
      createProject.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          teamSlug: null,
          name: "cloudflare-mcp",
          slug: null,
          platform: "node",
          regionUrl: null,
          repository: null,
        },
        context,
      ),
    ).rejects.toThrow(UserInputError);
    await expect(
      createProject.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          teamSlug: null,
          name: "cloudflare-mcp",
          slug: null,
          platform: "node",
          regionUrl: null,
          repository: null,
        },
        context,
      ),
    ).rejects.toThrow('No teams found in organization "sentry-mcp-evals"');
    expect(createCalls).toBe(0);
  });
});

describe("selectDefaultTeam", () => {
  it("returns null for an empty list", () => {
    expect(selectDefaultTeam([])).toBeNull();
  });

  it("prefers member teams over older non-member teams", () => {
    const selected = selectDefaultTeam([
      {
        id: "1",
        slug: "old",
        name: "old",
        isMember: false,
        hasAccess: true,
        dateCreated: "2019-01-01T00:00:00.000Z",
      },
      {
        id: "2",
        slug: "mine",
        name: "mine",
        isMember: true,
        hasAccess: true,
        dateCreated: "2024-01-01T00:00:00.000Z",
      },
    ]);

    expect(selected?.slug).toBe("mine");
  });

  it("falls back to hasAccess then earliest created slug", () => {
    const selected = selectDefaultTeam([
      {
        id: "1",
        slug: "zeta",
        name: "zeta",
        isMember: false,
        hasAccess: true,
        dateCreated: "2022-01-01T00:00:00.000Z",
      },
      {
        id: "2",
        slug: "alpha",
        name: "alpha",
        isMember: false,
        hasAccess: true,
        dateCreated: "2022-01-01T00:00:00.000Z",
      },
      {
        id: "3",
        slug: "no-access",
        name: "no-access",
        isMember: false,
        hasAccess: false,
        dateCreated: "2018-01-01T00:00:00.000Z",
      },
    ]);

    expect(selected?.slug).toBe("alpha");
  });
});
