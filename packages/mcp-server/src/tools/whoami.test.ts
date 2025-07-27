import { describe, it, expect } from "vitest";
import whoami from "./whoami.js";

describe("whoami", () => {
  it("serializes", async () => {
    const result = await whoami.handler(
      {},
      {
        accessToken: "access-token",
        userId: "123456",
        organizationSlug: null,
      },
    );
    expect(result).toMatchInlineSnapshot(
      `
      "You are authenticated as Test User (test@example.com).

      Your Sentry User ID is 123456."
    `,
    );
  });
});
