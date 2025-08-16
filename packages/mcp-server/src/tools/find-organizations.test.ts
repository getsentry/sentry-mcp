import { describe, it, expect } from "vitest";
import findOrganizations from "./find-organizations.js";

describe("find_organizations", () => {
  it("serializes", async () => {
    const result = await findOrganizations.handler(
      {},
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
      {},
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
      {},
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

  it("filters organizations when constrained to specific organization", async () => {
    const result = await findOrganizations.handler(
      {},
      {
        constraints: {
          organizationSlug: "sentry-mcp-evals",
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    // Should contain note about constraint
    expect(result).toContain(
      "This MCP session is constrained to organization **sentry-mcp-evals**",
    );
    expect(result).toContain(
      "Organization parameters will be automatically provided to tools",
    );

    // Should only show the constrained org
    expect(result).toContain("sentry-mcp-evals");
    expect(result).toMatchInlineSnapshot(`
      "# Organizations

      *Note: This MCP session is constrained to organization **sentry-mcp-evals**. Organization parameters will be automatically provided to tools.*
      *However, you still need to use this tool to get the regionUrl for API calls.*

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

  it("handles constraint to non-existent organization", async () => {
    const result = await findOrganizations.handler(
      {},
      {
        constraints: {
          organizationSlug: "non-existent-org",
        },
        accessToken: "access-token",
        userId: "1",
      },
    );

    expect(result).toContain(
      "This MCP session is constrained to organization **non-existent-org**",
    );
    expect(result).toContain(
      "The constrained organization **non-existent-org** was not found or you don't have access to it",
    );
  });
});
