import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";
import {
  assertStructuredOnlyResult,
  getStructuredContent,
} from "../../test-utils/structured-content.js";
import findTeams, { findTeamsOutputSchema } from "./find-teams.js";
import { getServerContext } from "../../test-setup.js";

describe("find_teams", () => {
  it("serializes", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/teams/",
        ({ request }) => {
          expect(new URL(request.url).searchParams.get("per_page")).toBe("26");
          return HttpResponse.json([
            {
              id: 4509106740854784,
              slug: "the-goats",
              name: "The Goats",
            },
          ]);
        },
      ),
    );

    const result = await findTeams.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        query: null,
        regionUrl: null,
      },
      getServerContext(),
    );
    assertStructuredOnlyResult(result);
    const structuredContent = getStructuredContent(result);
    expect(findTeamsOutputSchema.parse(structuredContent)).toEqual(
      structuredContent,
    );
    expect(structuredContent).toMatchInlineSnapshot(`
      {
        "hasMore": false,
        "teams": [
          {
            "id": "4509106740854784",
            "slug": "the-goats",
          },
        ],
      }
    `);
  });

  it("reports more results and returns only the first 25 teams", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/teams/",
        ({ request }) => {
          expect(new URL(request.url).searchParams.get("per_page")).toBe("26");
          return HttpResponse.json(
            Array.from({ length: 26 }, (_, index) => ({
              id: index + 1,
              slug: `team-${String(index + 1).padStart(2, "0")}`,
              name: `Team ${index + 1}`,
            })),
          );
        },
      ),
    );

    const result = await findTeams.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        query: null,
        regionUrl: null,
      },
      getServerContext(),
    );

    assertStructuredOnlyResult(result);
    expect(getStructuredContent(result)).toEqual({
      teams: Array.from({ length: 25 }, (_, index) => ({
        slug: `team-${String(index + 1).padStart(2, "0")}`,
        id: String(index + 1),
      })),
      hasMore: true,
    });
  });
});
