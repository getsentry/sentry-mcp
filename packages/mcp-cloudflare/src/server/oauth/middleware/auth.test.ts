import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../types";
import {
  encryptPropsWithNewKey,
  generateGrantId,
  generateToken,
  generateTokenId,
  wrapKeyWithToken,
} from "../crypto";
import { type InMemoryStorage, createInMemoryStorage } from "../storage";
import type { Grant, Token, WorkerProps } from "../types";
import { bearerAuth, requireScope } from "./auth";

describe("auth middleware", () => {
  let app: Hono<{ Bindings: Env }>;
  let storage: InMemoryStorage;

  const testProps: WorkerProps = {
    id: "user-123",
    accessToken: "sentry-access-token",
    refreshToken: "sentry-refresh-token",
    clientId: "test-client",
    scope: "org:read project:read",
    grantedSkills: ["issues", "projects"],
  };

  async function createValidToken(scopes: string[] = ["org:read"]) {
    const grantId = generateGrantId();
    const userId = "user-123";
    const accessToken = generateToken(userId, grantId);
    const accessTokenId = await generateTokenId(accessToken);

    const { encrypted, key } = await encryptPropsWithNewKey(testProps);
    const wrappedKey = await wrapKeyWithToken(accessToken, key);

    const grant: Grant = {
      id: grantId,
      clientId: "test-client",
      userId,
      scope: scopes,
      encryptedProps: JSON.stringify(encrypted),
      createdAt: Math.floor(Date.now() / 1000),
    };

    const token: Token = {
      id: accessTokenId,
      grantId,
      userId,
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      wrappedEncryptionKey: wrappedKey,
      grant: {
        clientId: grant.clientId,
        scope: grant.scope,
        encryptedProps: grant.encryptedProps,
      },
    };

    await storage.saveGrant(grant);
    await storage.saveToken(token, 3600);

    return { accessToken, grant, token };
  }

  beforeEach(() => {
    storage = createInMemoryStorage();

    app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("oauthStorage", storage);
      await next();
    });
  });

  describe("bearerAuth middleware", () => {
    beforeEach(() => {
      app.use("/protected/*", bearerAuth());
      app.get("/protected/resource", (c) => {
        const auth = c.get("auth");
        return c.json({ userId: auth?.props?.id });
      });
    });

    it("allows request with valid bearer token", async () => {
      const { accessToken } = await createValidToken();

      const response = await app.request("/protected/resource", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { userId: string };
      expect(body.userId).toBe("user-123");
    });

    it("rejects request without authorization header", async () => {
      const response = await app.request("/protected/resource");

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
    });

    it("rejects request with non-Bearer auth", async () => {
      const response = await app.request("/protected/resource", {
        headers: {
          Authorization: "Basic dXNlcjpwYXNz",
        },
      });

      expect(response.status).toBe(401);
    });

    it("rejects request with invalid token format", async () => {
      const response = await app.request("/protected/resource", {
        headers: {
          Authorization: "Bearer invalid-token",
        },
      });

      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("invalid_token");
    });

    it("rejects request with expired token", async () => {
      const grantId = generateGrantId();
      const userId = "user-123";
      const accessToken = generateToken(userId, grantId);
      const accessTokenId = await generateTokenId(accessToken);

      const { encrypted, key } = await encryptPropsWithNewKey(testProps);
      const wrappedKey = await wrapKeyWithToken(accessToken, key);

      // Create expired token
      const token: Token = {
        id: accessTokenId,
        grantId,
        userId,
        createdAt: Math.floor(Date.now() / 1000) - 7200,
        expiresAt: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        wrappedEncryptionKey: wrappedKey,
        grant: {
          clientId: "test-client",
          scope: ["org:read"],
          encryptedProps: JSON.stringify(encrypted),
        },
      };

      await storage.saveToken(token, 3600);

      const response = await app.request("/protected/resource", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("invalid_token");
    });

    it("rejects request with non-existent token", async () => {
      const fakeToken = generateToken("user-123", generateGrantId());

      const response = await app.request("/protected/resource", {
        headers: {
          Authorization: `Bearer ${fakeToken}`,
        },
      });

      expect(response.status).toBe(401);
    });

    it("sets auth context for downstream handlers", async () => {
      const { accessToken } = await createValidToken([
        "org:read",
        "project:read",
      ]);

      app.get("/protected/context", (c) => {
        const auth = c.get("auth");
        return c.json({
          userId: auth?.props?.id,
          scope: auth?.scope,
        });
      });

      const response = await app.request("/protected/context", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        userId: string;
        scope: string[];
      };
      expect(body.userId).toBe("user-123");
      expect(body.scope).toEqual(["org:read", "project:read"]);
    });
  });

  describe("requireScope middleware", () => {
    beforeEach(() => {
      app.use("/protected/*", bearerAuth());
      app.use("/protected/admin/*", requireScope("admin:write"));
      app.get("/protected/admin/action", (c) => c.json({ success: true }));
      app.get("/protected/public", (c) => c.json({ success: true }));
    });

    it("allows request with required scope", async () => {
      const { accessToken } = await createValidToken(["admin:write"]);

      const response = await app.request("/protected/admin/action", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.status).toBe(200);
    });

    it("rejects request without required scope", async () => {
      const { accessToken } = await createValidToken(["org:read"]);

      const response = await app.request("/protected/admin/action", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.status).toBe(403);
      expect(response.headers.get("WWW-Authenticate")).toContain(
        "insufficient_scope",
      );
    });

    it("allows request that doesn't need scope", async () => {
      const { accessToken } = await createValidToken(["org:read"]);

      const response = await app.request("/protected/public", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.status).toBe(200);
    });
  });

  describe("error response format", () => {
    beforeEach(() => {
      app.use("/protected/*", bearerAuth());
      app.get("/protected/resource", (c) => c.json({ ok: true }));
    });

    it("returns RFC 6750 compliant error response", async () => {
      const response = await app.request("/protected/resource", {
        headers: {
          Authorization: "Bearer invalid",
        },
      });

      expect(response.status).toBe(401);

      const body = (await response.json()) as {
        error: string;
        error_description: string;
      };
      expect(body.error).toBeDefined();
      expect(body.error_description).toBeDefined();

      const wwwAuth = response.headers.get("WWW-Authenticate");
      expect(wwwAuth).toContain('Bearer realm="sentry-mcp"');
      expect(wwwAuth).toContain("error=");
    });
  });
});
