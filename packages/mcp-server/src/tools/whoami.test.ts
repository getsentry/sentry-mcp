import { describe, it, expect } from "vitest";
import whoami from "./whoami.js";

describe("whoami", () => {
  it("serializes without constraints", async () => {
    const result = await whoami.handler(
      {},
      {
        constraints: {},
        accessToken: "access-token",
        userId: "123456",
      },
    );
    expect(result).toMatchInlineSnapshot(
      `
      "You are authenticated as Test User (test@example.com).

      Your Sentry User ID is 123456."
    `,
    );
  });

  it("serializes with constraints", async () => {
    const result = await whoami.handler(
      {},
      {
        constraints: {
          organizationSlug: "sentry",
          projectSlug: "mcp-server",
          regionUrl: "https://us.sentry.io",
        },
        accessToken: "access-token",
        userId: "123456",
      },
    );
    expect(result).toMatchInlineSnapshot(
      `
      "You are authenticated as Test User (test@example.com).

      Your Sentry User ID is 123456.

      ## Session Constraints

      - **Organization**: sentry
      - **Project**: mcp-server
      - **Region URL**: https://us.sentry.io

      These constraints limit the scope of this MCP session."
    `,
    );
  });

  it("serializes with partial constraints", async () => {
    const result = await whoami.handler(
      {},
      {
        constraints: {
          organizationSlug: "sentry",
        },
        accessToken: "access-token",
        userId: "123456",
      },
    );
    expect(result).toMatchInlineSnapshot(
      `
      "You are authenticated as Test User (test@example.com).

      Your Sentry User ID is 123456.

      ## Session Constraints

      - **Organization**: sentry

      These constraints limit the scope of this MCP session."
    `,
    );
  });
});
