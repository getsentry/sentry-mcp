import { describe, it, expect, beforeEach, vi } from "vitest";
import { CloudflareOAuthService } from "./oauth";
import { InMemoryStorage } from "./storage-interface";
import type { ClientInfo } from "@sentry/hono-oauth-provider";

describe("CloudflareOAuthService", () => {
  let service: CloudflareOAuthService;
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
    service = new CloudflareOAuthService(storage);
  });

  describe("client management", () => {
    it("should register and retrieve a client", async () => {
      const client: ClientInfo = {
        id: "test-client",
        name: "Test Client",
        secret: "test-secret",
        redirectUris: ["https://example.com/callback"],
      };

      await service.registerClient(client);
      const retrieved = await service.getClient("test-client");
      
      expect(retrieved).toEqual(client);
    });

    it("should return null for non-existent client", async () => {
      const client = await service.getClient("non-existent");
      expect(client).toBeNull();
    });
  });

  describe("grant creation", () => {
    it("should create a grant with authorization code", async () => {
      const grant = await service.createGrant("user123", "client456", "read write");
      
      expect(grant).toMatchObject({
        userId: "user123",
        clientId: "client456",
        scope: "read write",
      });
      expect(grant.id).toBeDefined();
      expect(grant.code).toBeDefined();
      expect(grant.createdAt).toBeLessThanOrEqual(Date.now());
      expect(grant.expiresAt).toBeGreaterThan(Date.now());
    });

    it("should store grant data encrypted", async () => {
      const grant = await service.createGrant("user123", "client456", "read");
      
      // Check that grant is stored (indirectly through storage)
      const allData = storage.getAll();
      const grantKey = Array.from(allData.keys()).find(k => k.startsWith("grant:"));
      expect(grantKey).toBeDefined();
      
      // The stored value should be encrypted (base64 string)
      const storedValue = allData.get(grantKey!);
      expect(typeof storedValue).toBe("string");
      expect(storedValue).toMatch(/^[A-Za-z0-9+/=]+$/); // Base64 pattern
    });
  });

  describe("code exchange", () => {
    it("should exchange authorization code for access token", async () => {
      // First create a grant
      const grant = await service.createGrant("user123", "client456", "read");
      
      // Exchange the code
      const token = await service.exchangeCode(grant.code, "client456");
      
      expect(token).toBeDefined();
      expect(token).toMatchObject({
        token_type: "Bearer",
        expires_in: 3600,
        scope: "read",
      });
      expect(token?.access_token).toBeDefined();
    });

    it("should reject code exchange with wrong client ID", async () => {
      const grant = await service.createGrant("user123", "client456", "read");
      const token = await service.exchangeCode(grant.code, "wrong-client");
      
      expect(token).toBeNull();
    });

    it("should reject invalid authorization code", async () => {
      const token = await service.exchangeCode("invalid-code", "client456");
      expect(token).toBeNull();
    });

    it("should prevent code reuse", async () => {
      const grant = await service.createGrant("user123", "client456", "read");
      
      // First exchange should succeed
      const token1 = await service.exchangeCode(grant.code, "client456");
      expect(token1).toBeDefined();
      
      // Second exchange should fail
      const token2 = await service.exchangeCode(grant.code, "client456");
      expect(token2).toBeNull();
    });
  });

  describe("token validation", () => {
    it("should validate a valid token", async () => {
      // Create grant and exchange for token
      const grant = await service.createGrant("user123", "client456", "read");
      const token = await service.exchangeCode(grant.code, "client456");
      
      expect(token).toBeDefined();
      
      // Validate the token
      const props = await service.validateToken(token!.access_token);
      
      expect(props).toBeDefined();
      expect(props).toMatchObject({
        id: "user123",
        scope: "read",
      });
    });

    it("should reject invalid token format", async () => {
      const props = await service.validateToken("invalid-token");
      expect(props).toBeNull();
    });

    it("should reject non-existent token", async () => {
      const props = await service.validateToken("user123.grant456.token789");
      expect(props).toBeNull();
    });

    it("should reject expired tokens", async () => {
      // This would require mocking time or waiting, so we'll simulate it
      // by directly manipulating storage
      const tokenData = {
        props: { id: "user123", accessToken: "test", name: "Test", scope: "read" },
        createdAt: Date.now() - 7200000, // 2 hours ago
        expiresAt: Date.now() - 3600000, // 1 hour ago
      };
      
      // Encrypt and store directly
      const encryptedData = await (service as any).encrypt(tokenData);
      const hashedTokenId = await (service as any).hashToken("token789");
      await storage.put(`token:user123:grant456:${hashedTokenId}`, encryptedData);
      
      // Try to validate expired token
      const props = await service.validateToken("user123.grant456.token789");
      expect(props).toBeNull();
      
      // Token should be deleted after validation attempt
      const remaining = await storage.get(`token:user123:grant456:${hashedTokenId}`);
      expect(remaining).toBeNull();
    });
  });

  describe("grant revocation", () => {
    it("should revoke a grant", async () => {
      const grant = await service.createGrant("user123", "client456", "read");
      
      // Revoke the grant
      await service.revokeGrant(grant.id, "user123");
      
      // Check that grant is deleted
      const allData = storage.getAll();
      const grantKey = Array.from(allData.keys()).find(k => 
        k === `grant:user123:${grant.id}`
      );
      expect(grantKey).toBeUndefined();
    });
  });

  describe("encryption", () => {
    it("should encrypt and decrypt data correctly", async () => {
      const originalData = { 
        secret: "sensitive-data", 
        number: 42,
        nested: { foo: "bar" }
      };
      
      const encrypted = await (service as any).encrypt(originalData);
      expect(typeof encrypted).toBe("string");
      expect(encrypted).not.toContain("sensitive-data");
      
      const decrypted = await (service as any).decrypt(encrypted);
      expect(decrypted).toEqual(originalData);
    });
  });

  describe("with mock KV namespace", () => {
    it("should work with KVNamespace", async () => {
      const mockKV = {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        getWithMetadata: vi.fn(), // This makes it identifiable as KVNamespace
      } as any;

      const kvService = new CloudflareOAuthService(mockKV);
      
      // Register a client
      const client: ClientInfo = {
        id: "test-client",
        name: "Test Client",
        secret: "test-secret",
        redirectUris: ["https://example.com/callback"],
      };
      
      await kvService.registerClient(client);
      
      // Verify KV was called
      expect(mockKV.put).toHaveBeenCalledWith(
        "client:test-client",
        JSON.stringify(client),
        undefined
      );
    });
  });
});