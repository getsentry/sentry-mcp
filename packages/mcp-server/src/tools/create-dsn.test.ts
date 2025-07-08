import { describe, it, expect } from "vitest";
import createDsn from "./create-dsn.js";

describe("create_dsn", () => {
  it("serializes", async () => {
    const result = await createDsn.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        name: "Default",
        regionUrl: undefined,
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# New DSN in **sentry-mcp-evals/cloudflare-mcp**

      **DSN**: https://d20df0a1ab5031c7f3c7edca9c02814d@o4509106732793856.ingest.us.sentry.io/4509109104082945
      **Name**: Default

      # Using this information

      - The \`SENTRY_DSN\` value is a URL that you can use to initialize Sentry's SDKs.
      "
    `);
  });
});
