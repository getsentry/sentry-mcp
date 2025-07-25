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
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
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
  it("returns json", async () => {
    const result = await createTeam.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        name: "the-goats",
        responseType: "json",
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );
    expect(result).toMatchObject({
      organizationSlug: "sentry-mcp-evals",
      team: {
        id: "4509109078196224",
        slug: "the-goats",
        name: "the-goats",
      },
    });
  });
});
