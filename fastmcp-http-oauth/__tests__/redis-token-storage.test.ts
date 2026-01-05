/**
 * Unit tests for RedisTokenStorage
 *
 * These tests mock the Redis client to test the storage logic
 * without requiring a real Redis connection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RedisTokenStorage, type RedisClient } from "../redis-token-storage.js";

// Mock Redis client
function createMockRedisClient(): RedisClient & {
  _store: Map<string, { value: string; ttl: number | null }>;
} {
  const store = new Map<string, { value: string; ttl: number | null }>();

  return {
    _store: store,

    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      return entry?.value ?? null;
    },

    async set(
      key: string,
      value: string,
      ...args: unknown[]
    ): Promise<unknown> {
      let ttl: number | null = null;
      // Parse EX argument
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "EX" && typeof args[i + 1] === "number") {
          ttl = args[i + 1] as number;
          break;
        }
      }
      store.set(key, { value, ttl });
      return "OK";
    },

    async del(key: string): Promise<number> {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    },

    async ttl(key: string): Promise<number> {
      const entry = store.get(key);
      if (!entry) return -2; // Key doesn't exist
      return entry.ttl ?? -1; // -1 means no TTL
    },

    async scan(
      cursor: string | number,
      ..._args: unknown[]
    ): Promise<[string, string[]]> {
      // Simple implementation that returns all keys in one batch
      if (cursor === "0" || cursor === 0) {
        return ["0", Array.from(store.keys())];
      }
      return ["0", []];
    },

    async quit(): Promise<void> {
      store.clear();
    },
  };
}

describe("RedisTokenStorage", () => {
  let mockClient: ReturnType<typeof createMockRedisClient>;
  let storage: RedisTokenStorage;

  beforeEach(() => {
    mockClient = createMockRedisClient();
    storage = new RedisTokenStorage({
      client: mockClient,
      keyPrefix: "test:oauth:",
    });
  });

  afterEach(async () => {
    storage.destroy();
    await mockClient.quit();
  });

  describe("save()", () => {
    it("should save a value without TTL", async () => {
      await storage.save("token:123", { accessToken: "abc123" });

      const stored = mockClient._store.get("test:oauth:token:123");
      expect(stored).toBeDefined();
      expect(stored?.ttl).toBeNull();

      const parsed = JSON.parse(stored!.value);
      expect(parsed.value).toEqual({ accessToken: "abc123" });
      expect(parsed.createdAt).toBeDefined();
      expect(parsed.expiresAt).toBeNull();
    });

    it("should save a value with TTL", async () => {
      await storage.save("token:456", { accessToken: "def456" }, 300);

      const stored = mockClient._store.get("test:oauth:token:456");
      expect(stored).toBeDefined();
      expect(stored?.ttl).toBe(300);

      const parsed = JSON.parse(stored!.value);
      expect(parsed.value).toEqual({ accessToken: "def456" });
      expect(parsed.expiresAt).toBeGreaterThan(Date.now());
    });

    it("should handle complex objects", async () => {
      const complexValue = {
        accessToken: "token123",
        refreshToken: "refresh456",
        scopes: ["org:read", "project:read"],
        metadata: {
          userId: "user-1",
          clientId: "client-1",
        },
      };

      await storage.save("token:complex", complexValue);

      const result = await storage.get("token:complex");
      expect(result).toEqual(complexValue);
    });
  });

  describe("get()", () => {
    it("should retrieve a stored value", async () => {
      await storage.save("token:789", { accessToken: "ghi789" });

      const result = await storage.get("token:789");
      expect(result).toEqual({ accessToken: "ghi789" });
    });

    it("should return null for non-existent key", async () => {
      const result = await storage.get("non-existent");
      expect(result).toBeNull();
    });

    it("should return null for expired entry (application-level check)", async () => {
      // Manually insert an expired entry
      const expiredData = JSON.stringify({
        value: { accessToken: "expired" },
        createdAt: Date.now() - 1000,
        expiresAt: Date.now() - 100, // Expired 100ms ago
      });
      mockClient._store.set("test:oauth:expired-token", {
        value: expiredData,
        ttl: null,
      });

      const result = await storage.get("expired-token");
      expect(result).toBeNull();

      // Should also delete the expired entry
      expect(mockClient._store.has("test:oauth:expired-token")).toBe(false);
    });

    it("should return null and delete invalid JSON", async () => {
      mockClient._store.set("test:oauth:invalid", {
        value: "not valid json",
        ttl: null,
      });

      const result = await storage.get("invalid");
      expect(result).toBeNull();
      expect(mockClient._store.has("test:oauth:invalid")).toBe(false);
    });
  });

  describe("delete()", () => {
    it("should delete an existing key", async () => {
      await storage.save("token:delete-me", { data: "to delete" });
      expect(mockClient._store.has("test:oauth:token:delete-me")).toBe(true);

      await storage.delete("token:delete-me");
      expect(mockClient._store.has("test:oauth:token:delete-me")).toBe(false);
    });

    it("should not throw for non-existent key", async () => {
      await expect(storage.delete("non-existent")).resolves.not.toThrow();
    });
  });

  describe("size()", () => {
    it("should return 0 for empty storage", async () => {
      const size = await storage.size();
      expect(size).toBe(0);
    });

    it("should return correct count of stored items", async () => {
      await storage.save("token:1", { id: 1 });
      await storage.save("token:2", { id: 2 });
      await storage.save("token:3", { id: 3 });

      const size = await storage.size();
      expect(size).toBe(3);
    });
  });

  describe("cleanup()", () => {
    it("should remove expired entries during cleanup", async () => {
      // Add a valid entry
      await storage.save("token:valid", { accessToken: "valid" });

      // Manually add an expired entry
      const expiredData = JSON.stringify({
        value: { accessToken: "expired" },
        createdAt: Date.now() - 1000,
        expiresAt: Date.now() - 100,
      });
      mockClient._store.set("test:oauth:token:expired", {
        value: expiredData,
        ttl: null,
      });

      // Add invalid JSON entry
      mockClient._store.set("test:oauth:token:invalid", {
        value: "not json",
        ttl: null,
      });

      await storage.cleanup();

      // Valid entry should remain
      const validResult = await storage.get("token:valid");
      expect(validResult).toEqual({ accessToken: "valid" });

      // Expired and invalid entries should be removed
      expect(mockClient._store.has("test:oauth:token:expired")).toBe(false);
      expect(mockClient._store.has("test:oauth:token:invalid")).toBe(false);
    });
  });

  describe("close()", () => {
    it("should cleanup and close the connection", async () => {
      await storage.save("token:test", { data: "test" });
      await storage.close();

      // After close, the mock store should be cleared
      expect(mockClient._store.size).toBe(0);
    });
  });

  describe("key prefix", () => {
    it("should use custom key prefix", async () => {
      const customStorage = new RedisTokenStorage({
        client: mockClient,
        keyPrefix: "custom:prefix:",
      });

      await customStorage.save("mykey", { value: "test" });

      expect(mockClient._store.has("custom:prefix:mykey")).toBe(true);
      expect(mockClient._store.has("test:oauth:mykey")).toBe(false);

      customStorage.destroy();
    });

    it("should use default key prefix when not specified", async () => {
      const defaultStorage = new RedisTokenStorage({
        client: mockClient,
      });

      await defaultStorage.save("mykey", { value: "test" });

      expect(mockClient._store.has("fastmcp:oauth:mykey")).toBe(true);

      defaultStorage.destroy();
    });
  });

  describe("cleanup interval", () => {
    it("should setup cleanup interval when configured", () => {
      vi.useFakeTimers();

      const intervalStorage = new RedisTokenStorage({
        client: mockClient,
        keyPrefix: "test:",
        cleanupIntervalMs: 1000,
      });

      // Spy on cleanup
      const cleanupSpy = vi.spyOn(intervalStorage, "cleanup");

      // Fast-forward time
      vi.advanceTimersByTime(3000);

      // Cleanup should have been called ~3 times
      expect(cleanupSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

      intervalStorage.destroy();
      vi.useRealTimers();
    });

    it("should not setup cleanup interval when set to 0", () => {
      vi.useFakeTimers();

      const noIntervalStorage = new RedisTokenStorage({
        client: mockClient,
        keyPrefix: "test:",
        cleanupIntervalMs: 0,
      });

      const cleanupSpy = vi.spyOn(noIntervalStorage, "cleanup");

      vi.advanceTimersByTime(5000);

      expect(cleanupSpy).not.toHaveBeenCalled();

      noIntervalStorage.destroy();
      vi.useRealTimers();
    });
  });
});
