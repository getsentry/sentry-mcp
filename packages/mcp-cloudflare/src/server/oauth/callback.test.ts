import { env } from "cloudflare:test";
import { getOAuthApi } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCOPES } from "../../constants";
import app from "../app";
import mcpHandler from "../lib/mcp-handler";
import type { Env } from "../types";
import oauthRoute from "./index";
import { signState, type OAuthState } from "./state";

const { exchangeCodeForAccessToken } = vi.hoisted(() => ({
  exchangeCodeForAccessToken: vi.fn(),
}));

vi.mock("./helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers")>();

  return {
    ...actual,
    exchangeCodeForAccessToken,
  };
});

const REDIRECT_URI = "https://example.com/callback";
const COOKIE_SECRET = "test-cookie-secret-key-for-hmac";

function createTestApp() {
  const hono = new Hono<{ Bindings: Env }>();
  hono.route("/oauth", oauthRoute);
  return hono;
}

function createOAuthApi(testEnv: Env) {
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
    testEnv,
  );
}

function createTestEnv(): Env {
  const baseEnv = {
    ...(env as Record<string, unknown>),
    COOKIE_SECRET,
    SENTRY_CLIENT_ID: "test-client-id",
    SENTRY_CLIENT_SECRET: "test-client-secret",
    SENTRY_HOST: "sentry.io",
  } as Env;

  return {
    ...baseEnv,
    OAUTH_PROVIDER: createOAuthApi(baseEnv),
  };
}

async function createClient(testEnv: Env, name = "Test Client") {
  return testEnv.OAUTH_PROVIDER.createClient({
    clientName: name,
    redirectUris: [REDIRECT_URI],
    tokenEndpointAuthMethod: "none",
  });
}

async function createSignedCallbackState(
  clientId: string,
  resource?: string,
): Promise<string> {
  const now = Date.now();
  const payload: OAuthState = {
    req: {
      clientId,
      redirectUri: REDIRECT_URI,
      scope: ["org:read"],
      skills: ["inspect"],
      ...(resource ? { resource } : {}),
    },
    iat: now,
    exp: now + 10 * 60 * 1000,
  } as unknown as OAuthState;

  return signState(payload, COOKIE_SECRET);
}

async function approveClient(
  oauthApp: ReturnType<typeof createTestApp>,
  testEnv: Env,
  clientId: string,
  resource?: string,
) {
  const approvalState = await signState(
    {
      req: {
        oauthReqInfo: {
          clientId,
          redirectUri: REDIRECT_URI,
          scope: ["org:read"],
          ...(resource ? { resource } : {}),
        },
      },
      iat: Date.now(),
      exp: Date.now() + 10 * 60 * 1000,
    },
    COOKIE_SECRET,
  );
  const formData = new FormData();
  formData.append("state", approvalState);
  formData.append("skill", "inspect");

  const response = await oauthApp.fetch(
    new Request("http://localhost/oauth/authorize", {
      method: "POST",
      body: formData,
    }),
    testEnv,
  );

  expect(response.status).toBe(302);

  return response.headers.get("Set-Cookie")?.split(";")[0];
}

async function callCallback(
  oauthApp: ReturnType<typeof createTestApp>,
  testEnv: Env,
  options: {
    state: string;
    cookie?: string;
    code?: string;
  },
) {
  const url = new URL("http://localhost/oauth/callback");
  url.searchParams.set("state", options.state);
  if (options.code) {
    url.searchParams.set("code", options.code);
  }

  return oauthApp.fetch(
    new Request(url, {
      method: "GET",
      headers: options.cookie ? { Cookie: options.cookie } : undefined,
    }),
    testEnv,
  );
}

describe("oauth callback routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exchangeCodeForAccessToken.mockResolvedValue([
      {
        access_token: "sentry-access-token",
        refresh_token: "sentry-refresh-token",
        expires_in: 3600,
        user: {
          id: "user-123",
          name: "Test User",
        },
      },
      null,
    ]);
  });

  describe("GET /oauth/callback", () => {
    it("rejects callback with invalid state param", async () => {
      const oauthApp = createTestApp();
      const response = await oauthApp.fetch(
        new Request(
          "http://localhost/oauth/callback?code=test-code&state=%%%INVALID%%%",
        ),
        createTestEnv(),
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Invalid state");
    });

    it("rejects callback without approved client cookie", async () => {
      const testEnv = createTestEnv();
      const oauthApp = createTestApp();
      const client = await createClient(testEnv);
      const state = await createSignedCallbackState(client.clientId);

      const response = await callCallback(oauthApp, testEnv, {
        state,
        code: "test-code",
      });

      expect(response.status).toBe(403);
      expect(await response.text()).toBe(
        "Authorization failed: Client not approved",
      );
    });

    it("rejects callback with invalid client approval cookie", async () => {
      const testEnv = createTestEnv();
      const oauthApp = createTestApp();
      const client = await createClient(testEnv);
      const state = await createSignedCallbackState(client.clientId);

      const response = await callCallback(oauthApp, testEnv, {
        state,
        code: "test-code",
        cookie: "mcp-approved-clients=invalid-cookie-value",
      });

      expect(response.status).toBe(403);
      expect(await response.text()).toBe(
        "Authorization failed: Client not approved",
      );
    });

    it("rejects callback with cookie for different client", async () => {
      const testEnv = createTestEnv();
      const oauthApp = createTestApp();
      const approvedClient = await createClient(testEnv, "Approved Client");
      const otherClient = await createClient(testEnv, "Other Client");
      const cookie = await approveClient(
        oauthApp,
        testEnv,
        approvedClient.clientId,
      );
      const state = await createSignedCallbackState(otherClient.clientId);

      const response = await callCallback(oauthApp, testEnv, {
        state,
        code: "test-code",
        cookie,
      });

      expect(response.status).toBe(403);
      expect(await response.text()).toBe(
        "Authorization failed: Client not approved",
      );
    });

    it("rejects callback when state signature is tampered", async () => {
      const testEnv = createTestEnv();
      const oauthApp = createTestApp();
      const client = await createClient(testEnv);
      const cookie = await approveClient(oauthApp, testEnv, client.clientId);
      const signedState = await createSignedCallbackState(client.clientId);
      const [signature, payload] = signedState.split(".");
      const tamperedState = `${signature === "" ? "a" : `${signature.slice(0, -1)}a`}.${payload}`;

      const response = await callCallback(oauthApp, testEnv, {
        state: tamperedState,
        code: "test-code",
        cookie,
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Invalid state");
    });

    it.each([
      undefined,
      "http://localhost/mcp",
      "http://localhost/mcp?experimental=1",
      "http://localhost/mcp/test-org",
      "http://localhost/mcp/test-org/test-project",
    ])("accepts callback with resource %s", async (resource) => {
      const testEnv = createTestEnv();
      const oauthApp = createTestApp();
      const client = await createClient(testEnv);
      const cookie = await approveClient(
        oauthApp,
        testEnv,
        client.clientId,
        resource,
      );
      const state = await createSignedCallbackState(client.clientId, resource);

      const response = await callCallback(oauthApp, testEnv, {
        state,
        code: "test-code",
        cookie,
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain(REDIRECT_URI);
      expect(response.headers.get("location")).toContain("code=");
    });

    it.each([
      "http://localhost/",
      "https://attacker.com/mcp",
      "http://localhost/api",
      "http://localhost#",
    ])("rejects callback with invalid resource %s", async (resource) => {
      const testEnv = createTestEnv();
      const oauthApp = createTestApp();
      const client = await createClient(testEnv);
      const cookie = await approveClient(oauthApp, testEnv, client.clientId);
      const state = await createSignedCallbackState(client.clientId, resource);

      const response = await callCallback(oauthApp, testEnv, {
        state,
        code: "test-code",
        cookie,
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Invalid resource parameter");
    });
  });
});
