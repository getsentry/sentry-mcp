import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../types";
import { type InMemoryStorage, createInMemoryStorage } from "../storage";
import registerRoute from "./register";

// Response body types for type assertions
interface RegistrationResponse {
  client_id: string;
  client_id_issued_at: number;
  client_secret?: string;
  client_secret_expires_at?: number;
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  token_endpoint_auth_method: string;
  grant_types: string[];
  response_types: string[];
}

interface ErrorResponse {
  error: string;
  error_description?: string;
}

describe("register endpoint", () => {
  let app: Hono<{ Bindings: Env }>;
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = createInMemoryStorage();

    // Create test app with storage middleware
    app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("oauthStorage", storage);
      await next();
    });
    app.route("/register", registerRoute);
  });

  describe("POST /register - successful registration", () => {
    it("registers public client with minimal metadata", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://example.com/callback"],
        }),
      });

      expect(response.status).toBe(201);

      const body = (await response.json()) as RegistrationResponse;
      expect(body.client_id).toBeDefined();
      expect(body.client_id_issued_at).toBeDefined();
      expect(body.redirect_uris).toEqual(["https://example.com/callback"]);
      expect(body.token_endpoint_auth_method).toBe("none");
      expect(body.grant_types).toEqual(["authorization_code", "refresh_token"]);
      expect(body.response_types).toEqual(["code"]);

      // Public clients don't get a secret
      expect(body.client_secret).toBeUndefined();
    });

    it("registers confidential client with secret", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://example.com/callback"],
          token_endpoint_auth_method: "client_secret_basic",
        }),
      });

      expect(response.status).toBe(201);

      const body = (await response.json()) as RegistrationResponse;
      expect(body.client_id).toBeDefined();
      expect(body.client_secret).toBeDefined();
      expect(body.client_secret_expires_at).toBe(0); // Never expires
      expect(body.token_endpoint_auth_method).toBe("client_secret_basic");
    });

    it("registers client with full metadata", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://example.com/callback"],
          client_name: "My App",
          client_uri: "https://example.com",
          logo_uri: "https://example.com/logo.png",
          token_endpoint_auth_method: "client_secret_post",
          grant_types: ["authorization_code"],
          response_types: ["code"],
        }),
      });

      expect(response.status).toBe(201);

      const body = (await response.json()) as RegistrationResponse;
      expect(body.client_name).toBe("My App");
      expect(body.client_uri).toBe("https://example.com");
      expect(body.logo_uri).toBe("https://example.com/logo.png");
      expect(body.token_endpoint_auth_method).toBe("client_secret_post");
      expect(body.grant_types).toEqual(["authorization_code"]);
    });

    it("stores client in storage", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://example.com/callback"],
          client_name: "Stored Client",
        }),
      });

      const body = (await response.json()) as RegistrationResponse;
      const stored = await storage.getClient(body.client_id);

      expect(stored).not.toBeNull();
      expect(stored!.clientName).toBe("Stored Client");
      expect(stored!.redirectUris).toEqual(["https://example.com/callback"]);
    });

    it("allows localhost for development", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["http://localhost:3000/callback"],
        }),
      });

      expect(response.status).toBe(201);
    });

    it("allows 127.0.0.1 for development", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["http://127.0.0.1:8080/callback"],
        }),
      });

      expect(response.status).toBe(201);
    });
  });

  describe("POST /register - validation errors", () => {
    it("rejects missing redirect_uris", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("redirect_uris");
    });

    it("rejects empty redirect_uris", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [],
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error).toBe("invalid_request");
    });

    it("rejects HTTP redirect URIs for non-localhost", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["http://example.com/callback"],
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error).toBe("invalid_redirect_uri");
    });

    it("rejects redirect URIs with fragments", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://example.com/callback#fragment"],
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error).toBe("invalid_redirect_uri");
    });

    it("rejects invalid token_endpoint_auth_method", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://example.com/callback"],
          token_endpoint_auth_method: "private_key_jwt",
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error).toBe("invalid_client_metadata");
    });

    it("rejects unsupported grant_types", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://example.com/callback"],
          grant_types: ["client_credentials"],
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error).toBe("invalid_client_metadata");
    });

    it("rejects unsupported response_types", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://example.com/callback"],
          response_types: ["token"],
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error).toBe("invalid_client_metadata");
    });

    it("rejects non-HTTPS client_uri", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://example.com/callback"],
          client_uri: "http://example.com",
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error).toBe("invalid_client_metadata");
    });

    it("rejects invalid JSON body", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error).toBe("invalid_request");
    });
  });

  describe("response headers", () => {
    it("includes cache-control headers", async () => {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://example.com/callback"],
        }),
      });

      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Pragma")).toBe("no-cache");
    });
  });
});
