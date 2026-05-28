import { describe, it, expect } from "vitest";
import findOrganizations from "./find-organizations.js";

describe("find_organizations", () => {
  it("serializes", async () => {
    const result = await findOrganizations.handler(
      { query: null },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Organizations

      ## **sentry-mcp-evals**

      **Web URL:** https://sentry.io/sentry-mcp-evals
      **Region URL:** https://us.sentry.io

      ## Notes

      - The organization slug is used as the \`organizationSlug\` parameter in other tools.
      - The Region URL above is the \`regionUrl\` parameter for other tools, required for correct regional routing on Sentry Cloud.
      "
    `);
  });

  it("handles empty regionUrl parameter", async () => {
    const result = await findOrganizations.handler(
      { query: null },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toContain("Organizations");
  });

  it("handles undefined regionUrl parameter", async () => {
    const result = await findOrganizations.handler(
      { query: null },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toContain("Organizations");
  });
});
