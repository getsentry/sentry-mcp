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
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Teams in **sentry-mcp-evals**

      - the-goats
      "
    `);
  });
});
