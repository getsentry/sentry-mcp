import { describe, it, expect } from "vitest";
import findDsns from "./find-dsns.js";

describe("find_dsns", () => {
  it("serializes", async () => {
    const result = await findDsns.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        regionUrl: null,
      },
      {
        constraints: {
          organizationSlug: null,
          projectSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# DSNs in **sentry-mcp-evals/cloudflare-mcp**

      ## Default
      **ID**: d20df0a1ab5031c7f3c7edca9c02814d
      **DSN**: https://d20df0a1ab5031c7f3c7edca9c02814d@o4509106732793856.ingest.us.sentry.io/4509109104082945

      # Using this information

      - The \`SENTRY_DSN\` value is a URL that you can use to initialize Sentry's SDKs.
      "
    `);
  });
});
