import { describe, it, expect, beforeEach, vi } from "vitest";
import { InMemoryStorage, CloudflareStorage } from "./storage-interface";

describe("InMemoryStorage", () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
  });

  describe("get/put operations", () => {
    it("should store and retrieve string values", async () => {
      await storage.put("test-key", "test-value");
      const value = await storage.get("test-key");
      expect(value).toBe("test-value");
    });

    it("should store and retrieve JSON values", async () => {
      const data = { foo: "bar", count: 42 };
      await storage.put("json-key", JSON.stringify(data));
      const retrieved = await storage.get("json-key", { type: "json" });
      expect(retrieved).toEqual(data);
    });

    it("should return null for non-existent keys", async () => {
      const value = await storage.get("non-existent");
      expect(value).toBeNull();
    });

    it("should handle invalid JSON gracefully", async () => {
      await storage.put("bad-json", "not-json{");
      const value = await storage.get("bad-json", { type: "json" });
      expect(value).toBeNull();
    });
  });

  describe("expiration", () => {
    it("should expire values after TTL", async () => {
      await storage.put("expiring-key", "value", { expirationTtl: 1 });
      
      // Should exist immediately
      let value = await storage.get("expiring-key");
      expect(value).toBe("value");
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Should be expired
      value = await storage.get("expiring-key");
      expect(value).toBeNull();
    });

    it("should not expire values without TTL", async () => {
      await storage.put("permanent-key", "value");
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should still exist
      const value = await storage.get("permanent-key");
      expect(value).toBe("value");
    });
  });

  describe("delete operations", () => {
    it("should delete existing keys", async () => {
      await storage.put("delete-me", "value");
      let value = await storage.get("delete-me");
      expect(value).toBe("value");
      
      await storage.delete("delete-me");
      value = await storage.get("delete-me");
      expect(value).toBeNull();
    });

    it("should handle deleting non-existent keys", async () => {
      // Should not throw
      await expect(storage.delete("non-existent")).resolves.toBeUndefined();
    });
  });

  describe("list operations", () => {
    beforeEach(async () => {
      await storage.put("prefix:key1", "value1");
      await storage.put("prefix:key2", "value2");
      await storage.put("other:key3", "value3");
    });

    it("should list all keys without prefix", async () => {
      const result = await storage.list();
      expect(result.keys).toHaveLength(3);
      expect(result.keys.map(k => k.name)).toContain("prefix:key1");
      expect(result.keys.map(k => k.name)).toContain("prefix:key2");
      expect(result.keys.map(k => k.name)).toContain("other:key3");
    });

    it("should list keys with matching prefix", async () => {
      const result = await storage.list({ prefix: "prefix:" });
      expect(result.keys).toHaveLength(2);
      expect(result.keys.map(k => k.name)).toContain("prefix:key1");
      expect(result.keys.map(k => k.name)).toContain("prefix:key2");
      expect(result.keys.map(k => k.name)).not.toContain("other:key3");
    });

    it("should return empty list for non-matching prefix", async () => {
      const result = await storage.list({ prefix: "nonexistent:" });
      expect(result.keys).toHaveLength(0);
    });
  });

  describe("test utilities", () => {
    it("should clear all data", async () => {
      await storage.put("key1", "value1");
      await storage.put("key2", "value2");
      
      storage.clear();
      
      const value1 = await storage.get("key1");
      const value2 = await storage.get("key2");
      expect(value1).toBeNull();
      expect(value2).toBeNull();
    });

    it("should get all stored data", async () => {
      await storage.put("key1", "value1");
      await storage.put("key2", JSON.stringify({ foo: "bar" }));
      
      const all = storage.getAll();
      expect(all.size).toBe(2);
      expect(all.get("key1")).toBe("value1");
      expect(all.get("key2")).toEqual({ foo: "bar" });
    });

    it("should filter out expired items in getAll", async () => {
      await storage.put("permanent", "value");
      await storage.put("expired", "value", { expirationTtl: 0.001 });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const all = storage.getAll();
      expect(all.size).toBe(1);
      expect(all.has("permanent")).toBe(true);
      expect(all.has("expired")).toBe(false);
    });
  });
});

describe("CloudflareStorage", () => {
  it("should pass through to KV namespace", async () => {
    const mockKV = {
      get: vi.fn().mockResolvedValue("value"),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ keys: [{ name: "key1" }] }),
    } as any;

    const storage = new CloudflareStorage(mockKV);

    // Test get
    const value = await storage.get("key");
    expect(mockKV.get).toHaveBeenCalledWith("key", undefined);
    expect(value).toBe("value");

    // Test get with JSON
    await storage.get("key", { type: "json" });
    expect(mockKV.get).toHaveBeenCalledWith("key", { type: "json" });

    // Test put
    await storage.put("key", "value");
    expect(mockKV.put).toHaveBeenCalledWith("key", "value", undefined);

    // Test put with TTL
    await storage.put("key", "value", { expirationTtl: 60 });
    expect(mockKV.put).toHaveBeenCalledWith("key", "value", { expirationTtl: 60 });

    // Test delete
    await storage.delete("key");
    expect(mockKV.delete).toHaveBeenCalledWith("key");

    // Test list
    const result = await storage.list({ prefix: "test:" });
    expect(mockKV.list).toHaveBeenCalledWith({ prefix: "test:" });
    expect(result).toEqual({ keys: [{ name: "key1" }] });
  });
});