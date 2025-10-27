import { describe, it, expect } from "vitest";
import createTeam from "./create-team.js";

describe("create_team", () => {
  it("serializes", async () => {
    const result = await createTeam.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        name: "the-goats",
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
      "# New Team in **sentry-mcp-evals**

      **ID**: 4509109078196224
      **Slug**: the-goats
      **Name**: the-goats
      # Using this information

      - You should always inform the user of the Team Slug value.
      "
    `);
  });
});
