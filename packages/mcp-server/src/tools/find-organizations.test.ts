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

      # Using this information

      - The organization's name is the identifier for the organization, and is used in many tools for \`organizationSlug\`.
      - If a tool supports passing in the \`regionUrl\`, you MUST pass in the correct value shown above for each organization.
      - For Sentry's Cloud Service (sentry.io), always use the regionUrl to ensure requests go to the correct region.
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
