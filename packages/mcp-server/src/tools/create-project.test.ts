import { describe, it, expect } from "vitest";
import createProject from "./create-project.js";

describe("create_project", () => {
  it("serializes", async () => {
    const result = await createProject.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        teamSlug: "the-goats",
        name: "cloudflare-mcp",
        platform: "node",
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
      "# New Project in **sentry-mcp-evals**

      **ID**: 4509109104082945
      **Slug**: cloudflare-mcp
      **Name**: cloudflare-mcp
      **SENTRY_DSN**: https://d20df0a1ab5031c7f3c7edca9c02814d@o4509106732793856.ingest.us.sentry.io/4509109104082945

      # Using this information

      - You can reference the **SENTRY_DSN** value to initialize Sentry's SDKs.
      - You should always inform the user of the **SENTRY_DSN** and Project Slug values.
      "
    `);
  });
});
