import "../../../test-utils/fetch-mock-hooks";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateMCPClient,
  mockStreamText,
  mockConvertToModelMessages,
  mockOpenai,
  mockGetOrRegisterChatClient,
  mockGetSecureCookieOptions,
  mockMcpClient,
} = vi.hoisted(() => {
  const mockMcpClient = {
    tools: vi.fn(),
    close: vi.fn(),
  };

  return {
    mockCreateMCPClient: vi.fn(),
    mockStreamText: vi.fn(),
    mockConvertToModelMessages: vi.fn(),
    mockOpenai: vi.fn(),
    mockGetOrRegisterChatClient: vi.fn(),
    mockGetSecureCookieOptions: vi.fn(),
    mockMcpClient,
  };
});

vi.mock("@ai-sdk/mcp", () => ({
  experimental_createMCPClient: mockCreateMCPClient,
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: mockOpenai,
}));

vi.mock("ai", () => ({
  streamText: mockStreamText,
  convertToModelMessages: mockConvertToModelMessages,
  stepCountIs: vi.fn(() => "stop-condition"),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../chat-oauth", () => ({
  getOrRegisterChatClient: mockGetOrRegisterChatClient,
  getSecureCookieOptions: mockGetSecureCookieOptions,
}));

import app from "../../app";

function buildAuthCookie(
  overrides?: Partial<{
    access_token: string;
    refresh_token: string;
    expires_at: string;
    token_type: string;
  }>,
): string {
  return encodeURIComponent(
    JSON.stringify({
      access_token: "test-access-token",
      refresh_token: "test-refresh-token",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      token_type: "Bearer",
      ...overrides,
    }),
  );
}

describe("/api/chat integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockMcpClient.tools.mockResolvedValue({
      find_organizations: {},
    });
    mockMcpClient.close.mockResolvedValue(undefined);
    mockCreateMCPClient.mockResolvedValue(mockMcpClient);

    mockOpenai.mockReturnValue("mock-model");
    mockConvertToModelMessages.mockResolvedValue([]);
    mockStreamText.mockReturnValue({
      toUIMessageStreamResponse: () =>
        new Response("chat-ok", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    });
    mockGetOrRegisterChatClient.mockResolvedValue("chat-client-id");
    mockGetSecureCookieOptions.mockReturnValue({
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
  });

  it("returns a streamed chat response when authenticated via cookie", async () => {
    const res = await app.request(
      "/api/chat",
      {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
          "Content-Type": "application/json",
          Cookie: `sentry_auth_data=${buildAuthCookie()}`,
        },
        body: JSON.stringify({
          messages: [],
          endpointMode: "standard",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("chat-ok");
    expect(mockCreateMCPClient).toHaveBeenCalledTimes(1);
    expect(mockStreamText).toHaveBeenCalledTimes(1);
  });

  it("refreshes the chat token and retries when the initial MCP auth fails", async () => {
    const authError = new Error("401 unauthorized");
    mockCreateMCPClient
      .mockRejectedValueOnce(authError)
      .mockResolvedValueOnce(mockMcpClient);

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;

        if (url.endsWith("/oauth/token")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: "refreshed-access-token",
                refresh_token: "refreshed-refresh-token",
                expires_in: 3600,
                token_type: "Bearer",
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }

        return originalFetch(input, init);
      });

    const res = await app.request(
      "/api/chat",
      {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
          "Content-Type": "application/json",
          Cookie: `sentry_auth_data=${buildAuthCookie({
            access_token: "expired-access-token",
            expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
          })}`,
        },
        body: JSON.stringify({
          messages: [],
          endpointMode: "standard",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("chat-ok");
    expect(mockCreateMCPClient).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost/oauth/token",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(res.headers.get("Set-Cookie")).toContain("sentry_auth_data=");

    fetchSpy.mockRestore();
  });
});
