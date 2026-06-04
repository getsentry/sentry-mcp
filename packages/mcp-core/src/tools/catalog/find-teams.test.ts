import { describe, it, expect } from "vitest";
import findTeams from "./find-teams.js";

describe("find_teams", () => {
  it("serializes", async () => {
    const result = await findTeams.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        query: null,
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
      "# Teams in **sentry-mcp-evals**

      - the-goats (ID: 4509106740854784)
      "
    `);
  });
});
