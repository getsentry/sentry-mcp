/**
 * Redis/Valkey Token Storage Implementation for FastMCP OAuth Proxy
 *
 * Implements the TokenStorage interface for distributed, stateless deployments.
 * Compatible with Redis, Valkey, KeyDB, and any Redis-protocol compatible store.
 */

import type { TokenStorage } from "fastmcp/auth";

/**
 * Redis client interface - compatible with ioredis, redis, and similar clients
 */
export interface RedisClient {
  del(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  quit(): Promise<void>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  ttl(key: string): Promise<number>;
  // SCAN is used instead of KEYS for ElastiCache Serverless compatibility
  scan(
    cursor: string | number,
    ...args: unknown[]
  ): Promise<[string, string[]]>;
}

export interface RedisTokenStorageOptions {
  /**
   * Redis client instance (ioredis, redis, etc.)
   */
  client: RedisClient;

  /**
   * Key prefix for all stored tokens
   * @default "fastmcp:oauth:"
   */
  keyPrefix?: string;

  /**
   * How often to run cleanup (in milliseconds)
   * Set to 0 to disable automatic cleanup (Redis TTL handles expiration)
   * @default 0 (disabled - relies on Redis TTL)
   */
  cleanupIntervalMs?: number;
}

/**
 * Redis-based token storage with TTL support
 *
 * Designed for distributed, stateless deployments where multiple
 * MCP server instances need to share OAuth state.
 *
 * @example
 * ```typescript
 * import Redis from "ioredis";
 * import { RedisTokenStorage } from "./redis-token-storage";
 *
 * const redis = new Redis({
 *   host: "localhost",
 *   port: 6379,
 *   // For Valkey:
 *   // host: "valkey.example.com",
 *   // port: 6379,
 * });
 *
 * const tokenStorage = new RedisTokenStorage({
 *   client: redis,
 *   keyPrefix: "sentry-mcp:oauth:",
 * });
 * ```
 */
export class RedisTokenStorage implements TokenStorage {
  private client: RedisClient;
  private keyPrefix: string;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: RedisTokenStorageOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? "fastmcp:oauth:";

    // Start cleanup interval if configured
    const cleanupMs = options.cleanupIntervalMs ?? 0;
    if (cleanupMs > 0) {
      this.cleanupInterval = setInterval(() => {
        this.cleanup().catch(console.error);
      }, cleanupMs);
    }
  }

  /**
   * Build the full Redis key with prefix
   */
  private getKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  /**
   * Save a value with optional TTL
   *
   * @param key - Storage key
   * @param value - Value to store (will be JSON serialized)
   * @param ttl - Time-to-live in seconds (optional)
   */
  async save(key: string, value: unknown, ttl?: number): Promise<void> {
    const redisKey = this.getKey(key);
    const serialized = JSON.stringify({
      value,
      createdAt: Date.now(),
      expiresAt: ttl ? Date.now() + ttl * 1000 : null,
    });

    if (ttl && ttl > 0) {
      // Use Redis EX option for automatic expiration
      await this.client.set(redisKey, serialized, "EX", ttl);
    } else {
      await this.client.set(redisKey, serialized);
    }
  }

  /**
   * Retrieve a value
   *
   * @param key - Storage key
   * @returns The stored value or null if not found/expired
   */
  async get(key: string): Promise<unknown | null> {
    const redisKey = this.getKey(key);
    const data = await this.client.get(redisKey);

    if (!data) {
      return null;
    }

    try {
      const parsed = JSON.parse(data) as {
        value: unknown;
        createdAt: number;
        expiresAt: number | null;
      };

      // Check expiration (Redis TTL should handle this, but double-check)
      if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
        await this.delete(key);
        return null;
      }

      return parsed.value;
    } catch {
      // Invalid JSON, delete and return null
      await this.delete(key);
      return null;
    }
  }

  /**
   * Delete a value
   *
   * @param key - Storage key
   */
  async delete(key: string): Promise<void> {
    const redisKey = this.getKey(key);
    await this.client.del(redisKey);
  }

  /**
   * Scan keys matching a pattern using SCAN (ElastiCache Serverless compatible)
   * SCAN is used instead of KEYS to avoid blocking and for compatibility with
   * managed Redis services that disable the KEYS command.
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";

    do {
      const [nextCursor, batch] = await this.client.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== "0");

    return keys;
  }

  /**
   * Clean up expired entries
   *
   * Note: With Redis TTL, this is mostly unnecessary as Redis
   * automatically expires keys. However, this can be useful for
   * cleaning up entries that were saved without TTL.
   */
  async cleanup(): Promise<void> {
    // With Redis TTL, expired keys are automatically removed
    // This method exists for interface compliance and manual cleanup if needed
    const pattern = `${this.keyPrefix}*`;
    const keys = await this.scanKeys(pattern);

    const now = Date.now();
    for (const key of keys) {
      const data = await this.client.get(key);
      if (!data) continue;

      try {
        const parsed = JSON.parse(data) as { expiresAt: number | null };
        if (parsed.expiresAt && now > parsed.expiresAt) {
          await this.client.del(key);
        }
      } catch {
        // Invalid data, remove it
        await this.client.del(key);
      }
    }
  }

  /**
   * Destroy the storage and clear cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get the number of stored items (useful for monitoring)
   */
  async size(): Promise<number> {
    const pattern = `${this.keyPrefix}*`;
    const keys = await this.scanKeys(pattern);
    return keys.length;
  }

  /**
   * Close the Redis connection
   */
  async close(): Promise<void> {
    this.destroy();
    await this.client.quit();
  }
}
