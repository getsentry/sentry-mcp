import { describe, it, expect } from "vitest";
import whoami from "./whoami.js";

describe("whoami", () => {
  it("serializes", async () => {
    const result = await whoami.handler(
      {},
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );
    expect(result).toMatchInlineSnapshot(
      `
      "You are authenticated as John Doe (john.doe@example.com).

      Your Sentry User ID is 1."
    `,
    );
  });
  it("returns json", async () => {
    const result = await whoami.handler(
      { responseType: "json" },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      {
        "user": {
          "email": "john.doe@example.com",
          "id": "1",
          "name": "John Doe",
        },
      }
    `);
  });
});
