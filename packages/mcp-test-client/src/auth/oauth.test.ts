import { beforeEach, describe, expect, it, vi } from "vitest";
import open from "open";
import { OAuthClient } from "./oauth.js";

vi.mock("open", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

describe("OAuthClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("includes the protected resource in the authorization request", async () => {
    const client = new OAuthClient({
      mcpHost: "https://mcp.sentry.dev/mcp/sentry/javascript",
    });

    vi.spyOn(client as never, "getOrRegisterClientId").mockResolvedValue(
      "client-123",
    );
    vi.spyOn(client as never, "startCallbackServer").mockResolvedValue({
      waitForCallback: async () => ({
        code: "auth-code",
        state: "oauth-state",
      }),
    });
    vi.spyOn(client as never, "generateState").mockReturnValue("oauth-state");
    vi.spyOn(client as never, "generatePKCE").mockReturnValue({
      verifier: "verifier",
      challenge: "challenge",
    });
    vi.spyOn(client as never, "exchangeCodeForToken").mockResolvedValue({
      access_token: "access-token",
      token_type: "Bearer",
    });
    vi.spyOn(
      (client as never).configManager,
      "setAccessToken",
    ).mockResolvedValue(undefined);

    await client.authenticate();

    expect(open).toHaveBeenCalledTimes(1);
    const authUrl = new URL(vi.mocked(open).mock.calls[0][0]);
    expect(authUrl.origin).toBe("https://mcp.sentry.dev");
    expect(authUrl.pathname).toBe("/oauth/authorize");
    expect(authUrl.searchParams.get("resource")).toBe(
      "https://mcp.sentry.dev/mcp/sentry/javascript",
    );
  });
});
