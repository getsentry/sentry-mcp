import { mswServer, releaseFixture } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import getReleaseDetails from "./get-release-details.js";
import { prepareToolParams } from "../catalog-runtime/availability";

const context = {
  constraints: {
    organizationSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

describe("get_release_details", () => {
  it("serializes release details", async () => {
    const result = await getReleaseDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        releaseVersion: "8ce89484-0fec-4913-a2cd-e8e2d41dee36",
        projectSlugOrId: null,
        includeHealth: false,
        includeDeploys: true,
        includeCommits: true,
        limit: 10,
      },
      context,
    );

    expect(result).toMatchInlineSnapshot(`
      "# Release 8ce89484-0fec-4913-a2cd-e8e2d41dee36 in **sentry-mcp-evals**

      **ID**: 1402755016
      **Short Version**: 8ce89484-0fec-4913-a2cd-e8e2d41dee36
      **Created**: 2025-04-13T19:54:21.764Z
      **First Event**: 2025-04-13T19:54:21.000Z
      **Last Event**: 2025-04-13T20:28:23.000Z
      **New Issues**: 0
      **Projects**: cloudflare-mcp
      **URL**: [Open Release](https://sentry-mcp-evals.sentry.io/releases/8ce89484-0fec-4913-a2cd-e8e2d41dee36/)

      ## Deploys

      ### Deploy 98765

      **Environment**: production
      **Name**: prod deploy
      **Started**: 2025-04-13T20:00:00.000Z
      **Finished**: 2025-04-13T20:05:30.000Z
      **URL**: https://deploys.example.com/98765

      ## Commits

      - \`2ce6a2700fec4913a2cde8e2d41dee36\`: Fix duplicate tool registration
        - Author: Jane Developer
        - Repository: getsentry/sentry-mcp
        - Created: 2025-04-13T19:40:00.000Z

      ## Response Notes

      - Search issues introduced in this release with query \`release:8ce89484-0fec-4913-a2cd-e8e2d41dee36\`.
      "
    `);
  });

  it("rejects releases outside the active project constraint", async () => {
    const releaseVersion = "8ce89484-0fec-4913-a2cd-e8e2d41dee36";
    mswServer.use(
      http.get(
        `https://sentry.io/api/0/projects/sentry-mcp-evals/frontend/releases/${releaseVersion}/`,
        () => HttpResponse.json(releaseFixture),
      ),
    );

    await expect(
      getReleaseDetails.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          regionUrl: null,
          releaseVersion,
          projectSlugOrId: null,
          includeHealth: false,
          includeDeploys: true,
          includeCommits: true,
          limit: 10,
        },
        {
          ...context,
          constraints: {
            organizationSlug: "sentry-mcp-evals",
            projectSlug: "frontend",
          },
        },
      ),
    ).rejects.toThrow(
      'Release is outside the active project constraint. Expected project "frontend".',
    );
  });

  it("allows scoped release details when project refs are omitted", async () => {
    const releaseVersion = "8ce89484-0fec-4913-a2cd-e8e2d41dee36";
    mswServer.use(
      http.get(
        `https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/releases/${releaseVersion}/`,
        () => HttpResponse.json({ ...releaseFixture, projects: undefined }),
      ),
    );

    const result = await getReleaseDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        releaseVersion,
        projectSlugOrId: null,
        includeHealth: false,
        includeDeploys: false,
        includeCommits: false,
        limit: 10,
      },
      {
        ...context,
        constraints: {
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "cloudflare-mcp",
        },
      },
    );

    expect(result).toContain(
      `# Release ${releaseVersion} in **sentry-mcp-evals**`,
    );
  });

  it("rejects release health metadata outside the active project constraint", async () => {
    await expect(
      getReleaseDetails.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          regionUrl: null,
          releaseVersion: "8ce89484-0fec-4913-a2cd-e8e2d41dee36",
          projectSlugOrId: "123",
          includeHealth: true,
          includeDeploys: false,
          includeCommits: false,
          limit: 10,
        },
        {
          ...context,
          constraints: {
            organizationSlug: "sentry-mcp-evals",
            projectSlug: "cloudflare-mcp",
          },
        },
      ),
    ).rejects.toThrow(
      'Release project is outside the active project constraint. Expected project "cloudflare-mcp".',
    );
  });

  it("requires a project when release health is requested", async () => {
    await expect(
      getReleaseDetails.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          regionUrl: null,
          releaseVersion: "8ce89484-0fec-4913-a2cd-e8e2d41dee36",
          projectSlugOrId: null,
          includeHealth: true,
          includeDeploys: false,
          includeCommits: false,
          limit: 10,
        },
        context,
      ),
    ).rejects.toThrow(
      "Release health metadata requires a project. Provide `projectSlugOrId` or use a project-constrained session.",
    );
  });

  it("uses projectSlugOrId as the project scope", async () => {
    const requests: Array<{
      kind: "details" | "deploys" | "commits";
      url: string;
    }> = [];
    const releaseVersion = "8ce89484-0fec-4913-a2cd-e8e2d41dee36";
    mswServer.use(
      http.get(
        `https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/releases/${releaseVersion}/`,
        ({ request }) => {
          requests.push({ kind: "details", url: request.url });
          return HttpResponse.json(releaseFixture);
        },
      ),
      http.get(
        `https://sentry.io/api/0/organizations/sentry-mcp-evals/releases/${releaseVersion}/deploys/`,
        ({ request }) => {
          requests.push({ kind: "deploys", url: request.url });
          return HttpResponse.json([]);
        },
      ),
      http.get(
        `https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/releases/${releaseVersion}/commits/`,
        ({ request }) => {
          requests.push({ kind: "commits", url: request.url });
          return HttpResponse.json([]);
        },
      ),
    );

    await getReleaseDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        releaseVersion,
        projectSlugOrId: "cloudflare-mcp",
        includeHealth: false,
        includeDeploys: true,
        includeCommits: true,
        limit: 10,
      },
      context,
    );

    expect(requests).toHaveLength(3);
    const detailsRequest = requests.find(
      (request) => request.kind === "details",
    );
    const deploysRequest = requests.find(
      (request) => request.kind === "deploys",
    );
    const commitsRequest = requests.find(
      (request) => request.kind === "commits",
    );
    expect(detailsRequest).toBeDefined();
    expect(deploysRequest).toBeDefined();
    expect(commitsRequest).toBeDefined();
    expect(new URL(detailsRequest!.url).pathname).toBe(
      `/api/0/projects/sentry-mcp-evals/cloudflare-mcp/releases/${releaseVersion}/`,
    );
    expect(new URL(deploysRequest!.url).searchParams.get("projectSlug")).toBe(
      "cloudflare-mcp",
    );
    expect(new URL(commitsRequest!.url).pathname).toBe(
      `/api/0/projects/sentry-mcp-evals/cloudflare-mcp/releases/${releaseVersion}/commits/`,
    );
  });

  it("preserves mixed-case project slug in release detail endpoints", async () => {
    const requests: Array<{
      kind: "details" | "deploys" | "commits";
      url: string;
    }> = [];
    const releaseVersion = "8ce89484-0fec-4913-a2cd-e8e2d41dee36";
    mswServer.use(
      http.get(
        `https://sentry.io/api/0/projects/MyOrg/MyProject/releases/${releaseVersion}/`,
        ({ request }) => {
          requests.push({ kind: "details", url: request.url });
          return HttpResponse.json(releaseFixture);
        },
      ),
      http.get(
        `https://sentry.io/api/0/organizations/MyOrg/releases/${releaseVersion}/deploys/`,
        ({ request }) => {
          requests.push({ kind: "deploys", url: request.url });
          return HttpResponse.json([]);
        },
      ),
      http.get(
        `https://sentry.io/api/0/projects/MyOrg/MyProject/releases/${releaseVersion}/commits/`,
        ({ request }) => {
          requests.push({ kind: "commits", url: request.url });
          return HttpResponse.json([]);
        },
      ),
    );

    const params = prepareToolParams({
      tool: getReleaseDetails,
      params: {
        organizationSlug: " MyOrg ",
        regionUrl: null,
        releaseVersion,
        projectSlugOrId: " MyProject ",
        includeHealth: false,
        includeDeploys: true,
        includeCommits: true,
        limit: 10,
      },
      context,
    }) as Parameters<typeof getReleaseDetails.handler>[0];

    await getReleaseDetails.handler(params, context);

    expect(requests).toHaveLength(3);
    const detailsRequest = requests.find(
      (request) => request.kind === "details",
    );
    const deploysRequest = requests.find(
      (request) => request.kind === "deploys",
    );
    const commitsRequest = requests.find(
      (request) => request.kind === "commits",
    );
    expect(detailsRequest).toBeDefined();
    expect(deploysRequest).toBeDefined();
    expect(commitsRequest).toBeDefined();
    expect(new URL(detailsRequest!.url).pathname).toBe(
      `/api/0/projects/MyOrg/MyProject/releases/${releaseVersion}/`,
    );
    expect(new URL(deploysRequest!.url).pathname).toBe(
      `/api/0/organizations/MyOrg/releases/${releaseVersion}/deploys/`,
    );
    expect(new URL(deploysRequest!.url).searchParams.get("projectSlug")).toBe(
      "MyProject",
    );
    expect(new URL(commitsRequest!.url).pathname).toBe(
      `/api/0/projects/MyOrg/MyProject/releases/${releaseVersion}/commits/`,
    );
  });

  it("hides health metadata when includeHealth is false", async () => {
    const releaseVersion = "8ce89484-0fec-4913-a2cd-e8e2d41dee36";
    mswServer.use(
      http.get(
        `https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/releases/${releaseVersion}/`,
        () =>
          HttpResponse.json({
            ...releaseFixture,
            currentProjectMeta: {
              sessionsAdoption: "enabled",
            },
            adoptionStages: {
              sessions: "adopted",
            },
          }),
      ),
    );

    const result = await getReleaseDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        releaseVersion,
        projectSlugOrId: "cloudflare-mcp",
        includeHealth: false,
        includeDeploys: false,
        includeCommits: false,
        limit: 10,
      },
      context,
    );

    expect(result).not.toContain("Health And Project Metadata");
    expect(result).not.toContain("sessionsAdoption");
    expect(result).not.toContain("adoptionStages");
  });

  it("uses scoped release endpoints under an active project constraint", async () => {
    const requests: Array<{ kind: "deploys" | "commits"; url: string }> = [];
    const releaseVersion = "8ce89484-0fec-4913-a2cd-e8e2d41dee36";
    mswServer.use(
      http.get(
        `https://sentry.io/api/0/organizations/sentry-mcp-evals/releases/${releaseVersion}/deploys/`,
        ({ request }) => {
          requests.push({ kind: "deploys", url: request.url });
          return HttpResponse.json([]);
        },
      ),
      http.get(
        `https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/releases/${releaseVersion}/commits/`,
        ({ request }) => {
          requests.push({ kind: "commits", url: request.url });
          return HttpResponse.json([]);
        },
      ),
    );

    await getReleaseDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        releaseVersion,
        projectSlugOrId: null,
        includeHealth: false,
        includeDeploys: true,
        includeCommits: true,
        limit: 10,
      },
      {
        ...context,
        constraints: {
          organizationSlug: "sentry-mcp-evals",
          projectSlug: "cloudflare-mcp",
        },
      },
    );

    expect(requests).toHaveLength(2);
    const deploysRequest = requests.find(
      (request) => request.kind === "deploys",
    );
    const commitsRequest = requests.find(
      (request) => request.kind === "commits",
    );
    expect(deploysRequest).toBeDefined();
    expect(commitsRequest).toBeDefined();
    expect(new URL(deploysRequest!.url).searchParams.get("projectSlug")).toBe(
      "cloudflare-mcp",
    );
    expect(new URL(commitsRequest!.url).pathname).toBe(
      `/api/0/projects/sentry-mcp-evals/cloudflare-mcp/releases/${releaseVersion}/commits/`,
    );
    expect(
      new URL(commitsRequest!.url).searchParams.get("projectSlug"),
    ).toBeNull();
  });
});
