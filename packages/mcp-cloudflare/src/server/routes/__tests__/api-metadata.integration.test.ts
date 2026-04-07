import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateMCPClient, mockMcpClient } = vi.hoisted(() => {
  const mockMcpClient = {
    tools: vi.fn(),
    close: vi.fn(),
  };

  return {
    mockCreateMCPClient: vi.fn(),
    mockMcpClient,
  };
});

vi.mock("@ai-sdk/mcp", () => ({
  experimental_createMCPClient: mockCreateMCPClient,
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({})),
}));

import app from "../../app";

describe("/api/metadata integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpClient.tools.mockResolvedValue({
      find_organizations: {},
      search_issues: {},
    });
    mockMcpClient.close.mockResolvedValue(undefined);
    mockCreateMCPClient.mockResolvedValue(mockMcpClient);
  });

  it("returns metadata when authenticated via auth cookie", async () => {
    const authData = {
      access_token: "test-access-token",
      refresh_token: "test-refresh-token",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      token_type: "Bearer",
    };

    const res = await app.request(
      "/api/metadata",
      {
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
          Cookie: `sentry_auth_data=${encodeURIComponent(JSON.stringify(authData))}`,
        },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      type: "mcp-metadata",
      tools: ["find_organizations", "search_issues"],
    });
    expect(mockCreateMCPClient).toHaveBeenCalledTimes(1);
    expect(mockMcpClient.close).toHaveBeenCalledTimes(1);
  });

  it("returns metadata when authenticated via Authorization header", async () => {
    const res = await app.request(
      "/api/metadata",
      {
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
          Authorization: "Bearer header-token",
        },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      type: "mcp-metadata",
      tools: ["find_organizations", "search_issues"],
    });
    expect(mockCreateMCPClient).toHaveBeenCalledTimes(1);
  });
});
