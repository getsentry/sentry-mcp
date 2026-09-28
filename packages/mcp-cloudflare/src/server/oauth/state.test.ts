import { describe, expect, it } from "vitest";
import { signState, verifyAndParseState, type OAuthState } from "./state";

const TEST_SECRET = "test-secret";

describe("OAuth state", () => {
  it("round-trips Unicode request data", async () => {
    const payload: OAuthState = {
      req: {
        oauthReqInfo: {
          clientId: "日本語-client-🚀",
          redirectUri: "https://example.com/callback",
          scope: ["read"],
        },
      },
      iat: Date.now(),
      exp: Date.now() + 60_000,
    };

    const signedState = await signState(payload, TEST_SECRET);

    await expect(
      verifyAndParseState(signedState, TEST_SECRET),
    ).resolves.toEqual(payload);
  });
});
