import { createExecutionContext, env } from "cloudflare:test";
import { getOAuthApi } from "@cloudflare/workers-oauth-provider";
import { describe, expect, it } from "vitest";
import { SCOPES } from "../constants";
import app from "./app";
import handler from "./index";
import mcpHandler from "./lib/mcp-handler";
import { tokenExchangeCallback } from "./oauth";
import type { Env, WorkerProps } from "./types";

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
      tokenExchangeCallback: (options) =>
        tokenExchangeCallback(options, workerEnv),
      scopesSupported: Object.keys(SCOPES),
    },
    workerEnv,
  );
}

function createAuthRequest(clientId: string, resource: string) {
  const url = new URL("https://mcp.sentry.dev/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", "org:read");
  url.searchParams.set("state", "test-state");
  url.searchParams.set("resource", resource);

  return new Request(url);
}

function createTokenExchangeRequest(clientId: string, code: string) {
  return new Request("https://mcp.sentry.dev/oauth/token", {
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

function createMcpRequest(
  path: string,
  accessToken: string,
  method: string,
  params: Record<string, unknown>,
) {
  return new Request(`https://mcp.sentry.dev${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "CF-Connecting-IP": "192.0.2.1",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
}

async function issueAccessToken(resource: string) {
  const oauthApi = createOAuthApi();
  const client = await oauthApi.createClient({
    clientName: "MCP Integration Test Client",
    redirectUris: [REDIRECT_URI],
    tokenEndpointAuthMethod: "none",
  });
  const authRequest = await oauthApi.parseAuthRequest(
    createAuthRequest(client.clientId, resource),
  );
  const props: WorkerProps = {
    ...DEFAULT_WORKER_PROPS,
    clientId: client.clientId,
  };
  const { redirectTo } = await oauthApi.completeAuthorization({
    request: authRequest,
    userId: props.id,
    metadata: {
      clientName: client.clientName,
    },
    scope: ["org:read"],
    props,
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

  const tokenJson = (await tokenResponse.json()) as {
    access_token: string;
    token_type: string;
    resource?: string;
  };

  expect(tokenJson.token_type).toBe("bearer");
  expect(tokenJson.resource).toBe(resource);

  return tokenJson.access_token;
}

async function parseSseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));

  if (!dataLine) {
    throw new Error(`No SSE payload found in response: ${text}`);
  }

  return JSON.parse(dataLine.slice(6)) as T;
}

describe("/mcp", () => {
  it("authenticates through /oauth/token and serves MCP requests at /mcp", async () => {
    const accessToken = await issueAccessToken("https://mcp.sentry.dev/mcp");

    const ctx = createExecutionContext();
    const response = await handler.fetch!(
      createMcpRequest("/mcp", accessToken, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "integration-test-client", version: "1.0.0" },
      }),
      workerEnv,
      ctx,
    );

    expect(response.status).toBe(200);

    const body = await parseSseJson<{
      result?: { protocolVersion: string };
    }>(response);
    expect(body.result?.protocolVersion).toBeDefined();
  });

  it("authenticates through /oauth/token and serves scoped MCP requests", async () => {
    const accessToken = await issueAccessToken(
      "https://mcp.sentry.dev/mcp/sentry-mcp-evals",
    );

    const ctx = createExecutionContext();
    const response = await handler.fetch!(
      createMcpRequest("/mcp/sentry-mcp-evals", accessToken, "tools/list", {}),
      workerEnv,
      ctx,
    );

    expect(response.status).toBe(200);

    const body = await parseSseJson<{
      result?: { tools: Array<{ name: string }> };
    }>(response);
    expect(body.result?.tools.length).toBeGreaterThan(0);
  });
});
