import open from "open";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthClient } from "./oauth.js";

vi.mock("open", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

describe("OAuthClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
    delete process.env.MCP_OAUTH_REDIRECT_URI;
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

  it("sends one redirect URI to registration, authorization, and token exchange", async () => {
    const redirectUri = "http://192.168.1.20:8765/callback";
    process.env.MCP_OAUTH_REDIRECT_URI = redirectUri;

    const client = new OAuthClient({ mcpHost: "https://mcp.sentry.dev" });

    const registerClient = vi
      .spyOn(client as never, "registerClient")
      .mockResolvedValue("client-123");
    const exchangeCodeForToken = vi
      .spyOn(client as never, "exchangeCodeForToken")
      .mockResolvedValue({
        access_token: "access-token",
        token_type: "Bearer",
      });
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
    vi.spyOn(
      (client as never).configManager,
      "getOAuthClient",
    ).mockResolvedValue(null);
    vi.spyOn(
      (client as never).configManager,
      "setOAuthClientId",
    ).mockResolvedValue(undefined);
    vi.spyOn(
      (client as never).configManager,
      "setAccessToken",
    ).mockResolvedValue(undefined);

    await client.authenticate();

    // Registration is what binds the URI server-side; the other two are
    // validated against it and must match byte for byte.
    expect(registerClient).toHaveBeenCalledTimes(1);
    expect((client as never).redirect.redirectUri).toBe(redirectUri);
    expect(
      new URL(vi.mocked(open).mock.calls[0][0]).searchParams.get(
        "redirect_uri",
      ),
    ).toBe(redirectUri);
    expect(exchangeCodeForToken).toHaveBeenCalledTimes(1);
  });

  it("re-registers when the redirect URI no longer matches the stored client", async () => {
    process.env.MCP_OAUTH_REDIRECT_URI = "http://192.168.1.20:8765/callback";

    const client = new OAuthClient({ mcpHost: "https://mcp.sentry.dev" });

    const registerClient = vi
      .spyOn(client as never, "registerClient")
      .mockResolvedValue("client-new");
    vi.spyOn(
      (client as never).configManager,
      "getOAuthClient",
    ).mockResolvedValue({
      clientId: "client-old",
      mcpHost: "https://mcp.sentry.dev/mcp",
      redirectUri: "http://localhost:8765/callback",
      registeredAt: new Date().toISOString(),
    });
    const setOAuthClientId = vi
      .spyOn((client as never).configManager, "setOAuthClientId")
      .mockResolvedValue(undefined);

    const clientId = await (client as never).getOrRegisterClientId();

    expect(registerClient).toHaveBeenCalledTimes(1);
    expect(clientId).toBe("client-new");
    expect(setOAuthClientId).toHaveBeenCalledWith(
      "https://mcp.sentry.dev/mcp",
      "client-new",
      "http://192.168.1.20:8765/callback",
    );
  });

  it("reuses a client registered before the redirect URI was recorded", async () => {
    const client = new OAuthClient({ mcpHost: "https://mcp.sentry.dev" });

    const registerClient = vi.spyOn(client as never, "registerClient");
    vi.spyOn(
      (client as never).configManager,
      "getOAuthClient",
    ).mockResolvedValue({
      clientId: "client-legacy",
      mcpHost: "https://mcp.sentry.dev/mcp",
      registeredAt: new Date().toISOString(),
    });

    const clientId = await (client as never).getOrRegisterClientId();

    expect(clientId).toBe("client-legacy");
    expect(registerClient).not.toHaveBeenCalled();
  });
});
