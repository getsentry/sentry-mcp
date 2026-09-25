import { mswServer, teamFixture } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { afterEach, describe, it, expect } from "vitest";
import createTeam from "./create-team.js";

describe("create_team", () => {
  afterEach(() => {
    mswServer.resetHandlers();
  });

  it("returns structured team details", async () => {
    mswServer.use(
      http.post(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/teams/",
        async ({ request }) => {
          expect(await request.json()).toEqual({
            name: "Platform Engineering",
          });
          return HttpResponse.json(
            {
              ...teamFixture,
              id: 4509109078196224,
              slug: "platform-engineering",
              name: "Platform Engineering",
            },
            { status: 201 },
          );
        },
      ),
    );

    const result = await createTeam.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        name: "Platform Engineering",
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      {
        "structuredContent": {
          "team": {
            "id": "4509109078196224",
            "name": "Platform Engineering",
            "slug": "platform-engineering",
          },
        },
      }
    `);
  });
});
