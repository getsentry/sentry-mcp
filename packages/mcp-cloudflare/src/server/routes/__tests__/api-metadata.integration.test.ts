import { createExecutionContext, env } from "cloudflare:test";
import { getOAuthApi } from "@cloudflare/workers-oauth-provider";
import { describe, expect, it } from "vitest";
import { SCOPES } from "../../../constants";
import app from "../../app";
import handler from "../../index";
import mcpHandler from "../../lib/mcp-handler";
import type { Env, WorkerProps } from "../../types";

const workerEnv = {
  ...(env as Record<string, unknown>),
  CF_VERSION_METADATA: {
    id: "test-version-id",
  },
} as Env;

const REDIRECT_URI = "https://example.com/callback";

const DEFAULT_WORKER_PROPS: WorkerProps = {
  id: "test-user-123",
  accessToken: "upstream-access-token",
  refreshToken: "upstream-refresh-token",
  accessTokenExpiresAt: Date.now() + 10 * 60 * 1000,
  clientId: "",
  scope: "org:read",
  grantedSkills: ["inspect", "docs"],
};

function createOAuthApi() {
  return getOAuthApi(
    {
      apiRoute: "/mcp",
      apiHandler: mcpHandler,
      defaultHandler: app,
      authorizeEndpoint: "/oauth/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      scopesSupported: Object.keys(SCOPES),
    },
    workerEnv,
  );
}

function createAuthRequest(clientId: string, resource: string) {
  const url = new URL("http://localhost/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", "org:read");
  url.searchParams.set("state", "test-state");
  url.searchParams.set("resource", resource);

  return new Request(url);
}

function createTokenExchangeRequest(clientId: string, code: string) {
  return new Request("http://localhost/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });
}

async function issueAccessToken(resource: string) {
  const oauthApi = createOAuthApi();
  const client = await oauthApi.createClient({
    clientName: "Metadata Integration Test Client",
    redirectUris: [REDIRECT_URI],
    tokenEndpointAuthMethod: "none",
  });
  const authRequest = await oauthApi.parseAuthRequest(
    createAuthRequest(client.clientId, resource),
  );
  const { redirectTo } = await oauthApi.completeAuthorization({
    request: authRequest,
    userId: DEFAULT_WORKER_PROPS.id,
    metadata: {
      clientName: client.clientName,
    },
    scope: ["org:read"],
    props: {
      ...DEFAULT_WORKER_PROPS,
      clientId: client.clientId,
    },
  });
  const redirectUrl = new URL(redirectTo);
  const code = redirectUrl.searchParams.get("code");

  expect(code).toBeTruthy();

  const tokenCtx = createExecutionContext();
  const tokenResponse = await handler.fetch!(
    createTokenExchangeRequest(client.clientId, code!),
    workerEnv,
    tokenCtx,
  );

  expect(tokenResponse.status).toBe(200);

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
  };

  return tokens.access_token;
}

describe("/api/metadata integration", () => {
  it("returns metadata when authenticated via auth cookie", async () => {
    const accessToken = await issueAccessToken("http://localhost/mcp");
    const authData = {
      access_token: accessToken,
      refresh_token: "mcp-refresh-token",
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
      workerEnv,
    );

    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      type: string;
      tools: string[];
    };
    expect(payload.type).toBe("mcp-metadata");
    expect(Array.isArray(payload.tools)).toBe(true);
  });

  it("returns metadata when authenticated via Authorization header", async () => {
    const accessToken = await issueAccessToken("http://localhost/mcp");
    const res = await app.request(
      "/api/metadata",
      {
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
          Authorization: `Bearer ${accessToken}`,
        },
      },
      workerEnv,
    );

    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      type: string;
      tools: string[];
    };
    expect(payload.type).toBe("mcp-metadata");
    expect(Array.isArray(payload.tools)).toBe(true);
  });
});
