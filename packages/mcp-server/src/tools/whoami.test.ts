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
});
