import { describe, it, expect } from "vitest";
import findTeams from "./find-teams.js";

describe("find_teams", () => {
  it("serializes", async () => {
    const result = await findTeams.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: undefined,
      },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        id: "1",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Teams in **sentry-mcp-evals**

      - the-goats
      "
    `);
  });
});
