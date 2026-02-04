import { beforeEach, describe, expect, it } from "vitest";
import { type InMemoryStorage, createInMemoryStorage } from "./storage";
import type { ClientInfo, Grant, Token } from "./types";

describe("InMemoryStorage", () => {
  let storage: InMemoryStorage;

  const testClient: ClientInfo = {
    clientId: "test-client-id",
    clientSecret: "hashed-secret",
    redirectUris: ["https://example.com/callback"],
    clientName: "Test Client",
    tokenEndpointAuthMethod: "client_secret_basic",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    registrationDate: Math.floor(Date.now() / 1000),
  };

  const testGrant: Grant = {
    id: "grant-123",
    clientId: "test-client-id",
    userId: "user-456",
    scope: ["org:read", "project:read"],
    encryptedProps: "encrypted-props-data",
    createdAt: Math.floor(Date.now() / 1000),
    authCodeId: "auth-code-hash",
    authCodeWrappedKey: "wrapped-key-data",
  };

  const testToken: Token = {
    id: "token-id-hash",
    grantId: "grant-123",
    userId: "user-456",
    createdAt: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    wrappedEncryptionKey: "wrapped-key",
    grant: {
      clientId: "test-client-id",
      scope: ["org:read"],
      encryptedProps: "encrypted-props",
    },
  };

  beforeEach(() => {
    storage = createInMemoryStorage();
  });

  describe("client operations", () => {
    it("saves and retrieves client", async () => {
      await storage.saveClient(testClient);
      const retrieved = await storage.getClient(testClient.clientId);
      expect(retrieved).toEqual(testClient);
    });

    it("returns null for non-existent client", async () => {
      const result = await storage.getClient("non-existent");
      expect(result).toBeNull();
    });

    it("deletes client", async () => {
      await storage.saveClient(testClient);
      await storage.deleteClient(testClient.clientId);
      const result = await storage.getClient(testClient.clientId);
      expect(result).toBeNull();
    });
  });

  describe("grant operations", () => {
    it("saves and retrieves grant", async () => {
      await storage.saveGrant(testGrant);
      const retrieved = await storage.getGrant(testGrant.userId, testGrant.id);
      expect(retrieved).toEqual(testGrant);
    });

    it("returns null for non-existent grant", async () => {
      const result = await storage.getGrant("user", "non-existent");
      expect(result).toBeNull();
    });

    it("deletes grant", async () => {
      await storage.saveGrant(testGrant);
      await storage.deleteGrant(testGrant.userId, testGrant.id);
      const result = await storage.getGrant(testGrant.userId, testGrant.id);
      expect(result).toBeNull();
    });

    it("lists grants for user", async () => {
      const grant1 = { ...testGrant, id: "grant-1" };
      const grant2 = { ...testGrant, id: "grant-2" };

      await storage.saveGrant(grant1);
      await storage.saveGrant(grant2);

      const result = await storage.listUserGrants(testGrant.userId);
      expect(result.items).toHaveLength(2);
      expect(result.items.map((g) => g.id)).toContain("grant-1");
      expect(result.items.map((g) => g.id)).toContain("grant-2");
    });

    it("respects TTL for grants", async () => {
      await storage.saveGrant(testGrant, 1); // 1 second TTL

      // Should exist immediately
      let result = await storage.getGrant(testGrant.userId, testGrant.id);
      expect(result).not.toBeNull();

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      result = await storage.getGrant(testGrant.userId, testGrant.id);
      expect(result).toBeNull();
    });
  });

  describe("token operations", () => {
    it("saves and retrieves token", async () => {
      await storage.saveToken(testToken, 3600);
      const retrieved = await storage.getToken(
        testToken.userId,
        testToken.grantId,
        testToken.id,
      );
      expect(retrieved).toEqual(testToken);
    });

    it("returns null for non-existent token", async () => {
      const result = await storage.getToken("user", "grant", "non-existent");
      expect(result).toBeNull();
    });

    it("deletes token", async () => {
      await storage.saveToken(testToken, 3600);
      await storage.deleteToken(
        testToken.userId,
        testToken.grantId,
        testToken.id,
      );
      const result = await storage.getToken(
        testToken.userId,
        testToken.grantId,
        testToken.id,
      );
      expect(result).toBeNull();
    });

    it("respects TTL for tokens", async () => {
      await storage.saveToken(testToken, 1); // 1 second TTL

      // Should exist immediately
      let result = await storage.getToken(
        testToken.userId,
        testToken.grantId,
        testToken.id,
      );
      expect(result).not.toBeNull();

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      result = await storage.getToken(
        testToken.userId,
        testToken.grantId,
        testToken.id,
      );
      expect(result).toBeNull();
    });
  });

  describe("test helpers", () => {
    it("clear() removes all data", async () => {
      await storage.saveClient(testClient);
      await storage.saveGrant(testGrant);
      await storage.saveToken(testToken, 3600);

      storage.clear();

      expect(await storage.getClient(testClient.clientId)).toBeNull();
      expect(await storage.getGrant(testGrant.userId, testGrant.id)).toBeNull();
      expect(
        await storage.getToken(
          testToken.userId,
          testToken.grantId,
          testToken.id,
        ),
      ).toBeNull();
    });

    it("seed() populates initial data", async () => {
      storage.seed({
        clients: [testClient],
        grants: [{ grant: testGrant }],
      });

      const client = await storage.getClient(testClient.clientId);
      expect(client).toEqual(testClient);

      const grant = await storage.getGrant(testGrant.userId, testGrant.id);
      expect(grant).toEqual(testGrant);
    });

    it("snapshot() returns current state", async () => {
      await storage.saveClient(testClient);
      await storage.saveGrant(testGrant);

      const snapshot = storage.snapshot();

      expect(snapshot.clients).toContainEqual(testClient);
      expect(snapshot.grants).toContainEqual(testGrant);
    });
  });

  describe("pagination", () => {
    it("respects limit in listUserGrants", async () => {
      for (let i = 0; i < 5; i++) {
        await storage.saveGrant({ ...testGrant, id: `grant-${i}` });
      }

      const result = await storage.listUserGrants(testGrant.userId, {
        limit: 2,
      });
      expect(result.items).toHaveLength(2);
      expect(result.cursor).toBeDefined();
    });

    it("supports cursor-based pagination", async () => {
      for (let i = 0; i < 5; i++) {
        await storage.saveGrant({ ...testGrant, id: `grant-${i}` });
      }

      const page1 = await storage.listUserGrants(testGrant.userId, {
        limit: 2,
      });
      expect(page1.items).toHaveLength(2);

      const page2 = await storage.listUserGrants(testGrant.userId, {
        limit: 2,
        cursor: page1.cursor,
      });
      expect(page2.items).toHaveLength(2);

      // Items should be different
      const page1Ids = page1.items.map((g) => g.id);
      const page2Ids = page2.items.map((g) => g.id);
      expect(page1Ids).not.toEqual(page2Ids);
    });
  });
});
