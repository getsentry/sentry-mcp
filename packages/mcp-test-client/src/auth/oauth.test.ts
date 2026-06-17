import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import open from "open";
import { OAuthClient } from "./oauth.js";

vi.mock("open", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

type TestOAuthClient = OAuthClient & {
  configManager: {
    setOAuthClientId: (mcpHost: string, clientId: string) => Promise<void>;
    setAccessToken: (
      mcpHost: string,
      accessToken: string,
      expiresIn?: number,
    ) => Promise<void>;
  };
  registerClient: () => Promise<string>;
  startCallbackServer: () => Promise<{
    waitForCallback: () => Promise<{ code: string; state: string }>;
  }>;
  generateState: () => string;
  generatePKCE: () => { verifier: string; challenge: string };
  exchangeCodeForToken: (params: {
    code: string;
    codeVerifier: string;
    clientId: string;
  }) => Promise<{ access_token: string; token_type: string }>;
};

describe("OAuthClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes the protected resource in the authorization request", async () => {
    const client = new OAuthClient({
      mcpHost: "https://mcp.sentry.dev/mcp/sentry/javascript",
    });
    const testClient = client as TestOAuthClient;

    vi.spyOn(client as never, "getOrRegisterClientId").mockResolvedValue(
      "client-123",
    );
    vi.spyOn(testClient, "startCallbackServer").mockResolvedValue({
      waitForCallback: async () => ({
        code: "auth-code",
        state: "oauth-state",
      }),
    });
    vi.spyOn(testClient, "generateState").mockReturnValue("oauth-state");
    vi.spyOn(testClient, "generatePKCE").mockReturnValue({
      verifier: "verifier",
      challenge: "challenge",
    });
    vi.spyOn(testClient, "exchangeCodeForToken").mockResolvedValue({
      access_token: "access-token",
      token_type: "Bearer",
    });
    vi.spyOn(testClient.configManager, "setAccessToken").mockResolvedValue(
      undefined,
    );

    await client.authenticate();

    expect(open).toHaveBeenCalledTimes(1);
    const authUrl = new URL(vi.mocked(open).mock.calls[0][0]);
    expect(authUrl.origin).toBe("https://mcp.sentry.dev");
    expect(authUrl.pathname).toBe("/oauth/authorize");
    expect(authUrl.searchParams.get("resource")).toBe(
      "https://mcp.sentry.dev/mcp/sentry/javascript",
    );
  });

  it("uses a client metadata URL as the OAuth client ID without DCR", async () => {
    const clientMetadataUrl = "https://client.example/oauth/client.json";
    const client = new OAuthClient({
      mcpHost: "https://mcp.sentry.dev/mcp",
      clientMetadataUrl,
    });
    const testClient = client as TestOAuthClient;

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          client_id: "registered-client",
          redirect_uris: ["http://localhost:8976/callback"],
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.spyOn(testClient.configManager, "setOAuthClientId").mockResolvedValue(
      undefined,
    );
    vi.spyOn(testClient, "startCallbackServer").mockResolvedValue({
      waitForCallback: async () => ({
        code: "auth-code",
        state: "oauth-state",
      }),
    });
    vi.spyOn(testClient, "generateState").mockReturnValue("oauth-state");
    vi.spyOn(testClient, "generatePKCE").mockReturnValue({
      verifier: "verifier",
      challenge: "challenge",
    });
    vi.spyOn(testClient, "exchangeCodeForToken").mockResolvedValue({
      access_token: "access-token",
      token_type: "Bearer",
    });
    vi.spyOn(testClient.configManager, "setAccessToken").mockResolvedValue(
      undefined,
    );

    await client.authenticate();

    expect(
      fetchSpy.mock.calls.some(([input]) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return new URL(url).pathname === "/oauth/register";
      }),
    ).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    const authUrl = new URL(vi.mocked(open).mock.calls[0][0]);
    expect(authUrl.searchParams.get("client_id")).toBe(clientMetadataUrl);
  });

  it("includes the protected resource in the token exchange", async () => {
    const client = new OAuthClient({
      mcpHost: "https://mcp.sentry.dev/mcp/sentry/javascript",
    });
    const testClient = client as TestOAuthClient;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          token_type: "Bearer",
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );

    await testClient.exchangeCodeForToken({
      code: "auth-code",
      codeVerifier: "verifier",
      clientId: "client-123",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const body = new URLSearchParams(init?.body as string);
    expect(body.get("resource")).toBe(
      "https://mcp.sentry.dev/mcp/sentry/javascript",
    );
  });
});
