/**
 * OAuth Storage Layer
 *
 * Provides storage operations for OAuth entities (clients, grants, tokens).
 * Includes both a Cloudflare KV implementation for production and an
 * in-memory implementation for testing.
 *
 * Storage Schema:
 * - Clients: `client:{clientId}` -> ClientInfo JSON
 * - Grants: `grant:{userId}:{grantId}` -> Grant JSON
 * - Tokens: `token:{userId}:{grantId}:{tokenId}` -> Token JSON
 *
 * @see docs/oauth-provider.md for detailed schema documentation
 */

import type {
  ClientInfo,
  Grant,
  GrantSummary,
  ListOptions,
  ListResult,
  Token,
} from "./types";

// =============================================================================
// Storage Interface
// =============================================================================

/**
 * Interface for OAuth storage operations.
 *
 * Implementations must be async-safe and handle concurrent access.
 * All methods should be idempotent where possible.
 */
export interface OAuthStorage {
  // ---------------------------------------------------------------------------
  // Client Operations
  // ---------------------------------------------------------------------------

  /**
   * Get a client by ID.
   *
   * @param clientId - Client identifier
   * @returns Client info or null if not found
   */
  getClient(clientId: string): Promise<ClientInfo | null>;

  /**
   * Save a client.
   *
   * Creates or updates the client record.
   *
   * @param client - Client info to save
   */
  saveClient(client: ClientInfo): Promise<void>;

  /**
   * Delete a client.
   *
   * @param clientId - Client identifier
   */
  deleteClient(clientId: string): Promise<void>;

  /**
   * List all clients with pagination.
   *
   * @param options - Pagination options
   * @returns Paginated list of clients
   */
  listClients(options?: ListOptions): Promise<ListResult<ClientInfo>>;

  // ---------------------------------------------------------------------------
  // Grant Operations
  // ---------------------------------------------------------------------------

  /**
   * Get a grant by user ID and grant ID.
   *
   * Grants are keyed by both user ID and grant ID to enable
   * efficient listing of all grants for a user.
   *
   * @param userId - User identifier
   * @param grantId - Grant identifier
   * @returns Grant or null if not found
   */
  getGrant(userId: string, grantId: string): Promise<Grant | null>;

  /**
   * Save a grant.
   *
   * @param grant - Grant to save
   * @param ttl - Time-to-live in seconds (optional)
   */
  saveGrant(grant: Grant, ttl?: number): Promise<void>;

  /**
   * Delete a grant.
   *
   * @param userId - User identifier
   * @param grantId - Grant identifier
   */
  deleteGrant(userId: string, grantId: string): Promise<void>;

  /**
   * List all grants for a user.
   *
   * Returns summaries (without sensitive data like encrypted props).
   *
   * @param userId - User identifier
   * @param options - Pagination options
   * @returns Paginated list of grant summaries
   */
  listUserGrants(
    userId: string,
    options?: ListOptions,
  ): Promise<ListResult<GrantSummary>>;

  // ---------------------------------------------------------------------------
  // Token Operations
  // ---------------------------------------------------------------------------

  /**
   * Get a token by user ID, grant ID, and token ID.
   *
   * @param userId - User identifier
   * @param grantId - Grant identifier
   * @param tokenId - Token identifier (hash of full token)
   * @returns Token or null if not found
   */
  getToken(
    userId: string,
    grantId: string,
    tokenId: string,
  ): Promise<Token | null>;

  /**
   * Save a token.
   *
   * @param token - Token to save
   * @param ttl - Time-to-live in seconds
   */
  saveToken(token: Token, ttl: number): Promise<void>;

  /**
   * Delete a token.
   *
   * @param userId - User identifier
   * @param grantId - Grant identifier
   * @param tokenId - Token identifier
   */
  deleteToken(userId: string, grantId: string, tokenId: string): Promise<void>;

  /**
   * Delete all tokens for a grant.
   *
   * Used when revoking a grant.
   *
   * @param userId - User identifier
   * @param grantId - Grant identifier
   */
  deleteTokensForGrant(userId: string, grantId: string): Promise<void>;
}

// =============================================================================
// Cloudflare KV Implementation
// =============================================================================

/**
 * OAuth storage implementation using Cloudflare KV.
 *
 * Uses the OAUTH_KV namespace for all storage operations.
 * Supports TTL for automatic expiration of grants and tokens.
 */
export class KVStorage implements OAuthStorage {
  constructor(private kv: KVNamespace) {}

  // ---------------------------------------------------------------------------
  // Client Operations
  // ---------------------------------------------------------------------------

  async getClient(clientId: string): Promise<ClientInfo | null> {
    const key = `client:${clientId}`;
    return this.kv.get(key, "json");
  }

  async saveClient(client: ClientInfo): Promise<void> {
    const key = `client:${client.clientId}`;
    await this.kv.put(key, JSON.stringify(client));
  }

  async deleteClient(clientId: string): Promise<void> {
    const key = `client:${clientId}`;
    await this.kv.delete(key);
  }

  async listClients(options?: ListOptions): Promise<ListResult<ClientInfo>> {
    const listOptions: KVNamespaceListOptions = {
      prefix: "client:",
      limit: options?.limit,
      cursor: options?.cursor,
    };

    const response = await this.kv.list(listOptions);
    const clients: ClientInfo[] = [];

    // Fetch all clients in parallel
    const promises = response.keys.map(async (key) => {
      const client = await this.kv.get<ClientInfo>(key.name, "json");
      if (client) {
        clients.push(client);
      }
    });

    await Promise.all(promises);

    return {
      items: clients,
      cursor: response.list_complete ? undefined : response.cursor,
    };
  }

  // ---------------------------------------------------------------------------
  // Grant Operations
  // ---------------------------------------------------------------------------

  async getGrant(userId: string, grantId: string): Promise<Grant | null> {
    const key = `grant:${userId}:${grantId}`;
    return this.kv.get(key, "json");
  }

  async saveGrant(grant: Grant, ttl?: number): Promise<void> {
    const key = `grant:${grant.userId}:${grant.id}`;
    const options: KVNamespacePutOptions = ttl ? { expirationTtl: ttl } : {};
    await this.kv.put(key, JSON.stringify(grant), options);
  }

  async deleteGrant(userId: string, grantId: string): Promise<void> {
    const key = `grant:${userId}:${grantId}`;
    await this.kv.delete(key);
  }

  async listUserGrants(
    userId: string,
    options?: ListOptions,
  ): Promise<ListResult<GrantSummary>> {
    const listOptions: KVNamespaceListOptions = {
      prefix: `grant:${userId}:`,
      limit: options?.limit,
      cursor: options?.cursor,
    };

    const response = await this.kv.list(listOptions);
    const summaries: GrantSummary[] = [];

    const promises = response.keys.map(async (key) => {
      const grant = await this.kv.get<Grant>(key.name, "json");
      if (grant) {
        // Return summary without sensitive data
        summaries.push({
          id: grant.id,
          clientId: grant.clientId,
          userId: grant.userId,
          scope: grant.scope,
          metadata: grant.metadata,
          createdAt: grant.createdAt,
          expiresAt: grant.expiresAt,
        });
      }
    });

    await Promise.all(promises);

    return {
      items: summaries,
      cursor: response.list_complete ? undefined : response.cursor,
    };
  }

  // ---------------------------------------------------------------------------
  // Token Operations
  // ---------------------------------------------------------------------------

  async getToken(
    userId: string,
    grantId: string,
    tokenId: string,
  ): Promise<Token | null> {
    const key = `token:${userId}:${grantId}:${tokenId}`;
    return this.kv.get(key, "json");
  }

  async saveToken(token: Token, ttl: number): Promise<void> {
    const key = `token:${token.userId}:${token.grantId}:${token.id}`;
    await this.kv.put(key, JSON.stringify(token), { expirationTtl: ttl });
  }

  async deleteToken(
    userId: string,
    grantId: string,
    tokenId: string,
  ): Promise<void> {
    const key = `token:${userId}:${grantId}:${tokenId}`;
    await this.kv.delete(key);
  }

  async deleteTokensForGrant(userId: string, grantId: string): Promise<void> {
    const prefix = `token:${userId}:${grantId}:`;

    // KV list returns up to 1000 keys, need to paginate
    let cursor: string | undefined;
    let complete = false;

    while (!complete) {
      const listOptions: KVNamespaceListOptions = { prefix, cursor };
      const response = await this.kv.list(listOptions);

      // Delete all tokens in this batch
      await Promise.all(response.keys.map((key) => this.kv.delete(key.name)));

      complete = response.list_complete;
      cursor = !response.list_complete ? response.cursor : undefined;
    }
  }
}

// =============================================================================
// In-Memory Implementation (for testing)
// =============================================================================

/**
 * In-memory OAuth storage for testing.
 *
 * Provides the same interface as KVStorage but stores data in memory.
 * Includes additional helper methods for test setup and inspection.
 */
export class InMemoryStorage implements OAuthStorage {
  private clients = new Map<string, ClientInfo>();
  private grants = new Map<string, { grant: Grant; expiresAt?: number }>();
  private tokens = new Map<string, { token: Token; expiresAt?: number }>();

  // ---------------------------------------------------------------------------
  // Client Operations
  // ---------------------------------------------------------------------------

  async getClient(clientId: string): Promise<ClientInfo | null> {
    return this.clients.get(clientId) ?? null;
  }

  async saveClient(client: ClientInfo): Promise<void> {
    this.clients.set(client.clientId, client);
  }

  async deleteClient(clientId: string): Promise<void> {
    this.clients.delete(clientId);
  }

  async listClients(options?: ListOptions): Promise<ListResult<ClientInfo>> {
    const items = Array.from(this.clients.values());
    return this.paginate(items, options);
  }

  // ---------------------------------------------------------------------------
  // Grant Operations
  // ---------------------------------------------------------------------------

  async getGrant(userId: string, grantId: string): Promise<Grant | null> {
    const key = `${userId}:${grantId}`;
    const entry = this.grants.get(key);

    if (!entry) return null;

    // Check TTL expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.grants.delete(key);
      return null;
    }

    return entry.grant;
  }

  async saveGrant(grant: Grant, ttl?: number): Promise<void> {
    const key = `${grant.userId}:${grant.id}`;
    const expiresAt = ttl ? Date.now() + ttl * 1000 : undefined;
    this.grants.set(key, { grant, expiresAt });
  }

  async deleteGrant(userId: string, grantId: string): Promise<void> {
    const key = `${userId}:${grantId}`;
    this.grants.delete(key);
  }

  async listUserGrants(
    userId: string,
    options?: ListOptions,
  ): Promise<ListResult<GrantSummary>> {
    const prefix = `${userId}:`;
    const now = Date.now();

    const summaries: GrantSummary[] = [];
    for (const [key, entry] of this.grants) {
      if (!key.startsWith(prefix)) continue;
      if (entry.expiresAt && now > entry.expiresAt) continue;

      const grant = entry.grant;
      summaries.push({
        id: grant.id,
        clientId: grant.clientId,
        userId: grant.userId,
        scope: grant.scope,
        metadata: grant.metadata,
        createdAt: grant.createdAt,
        expiresAt: grant.expiresAt,
      });
    }

    return this.paginate(summaries, options);
  }

  // ---------------------------------------------------------------------------
  // Token Operations
  // ---------------------------------------------------------------------------

  async getToken(
    userId: string,
    grantId: string,
    tokenId: string,
  ): Promise<Token | null> {
    const key = `${userId}:${grantId}:${tokenId}`;
    const entry = this.tokens.get(key);

    if (!entry) return null;

    // Check TTL expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.tokens.delete(key);
      return null;
    }

    return entry.token;
  }

  async saveToken(token: Token, ttl: number): Promise<void> {
    const key = `${token.userId}:${token.grantId}:${token.id}`;
    const expiresAt = Date.now() + ttl * 1000;
    this.tokens.set(key, { token, expiresAt });
  }

  async deleteToken(
    userId: string,
    grantId: string,
    tokenId: string,
  ): Promise<void> {
    const key = `${userId}:${grantId}:${tokenId}`;
    this.tokens.delete(key);
  }

  async deleteTokensForGrant(userId: string, grantId: string): Promise<void> {
    const prefix = `${userId}:${grantId}:`;
    for (const key of this.tokens.keys()) {
      if (key.startsWith(prefix)) {
        this.tokens.delete(key);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Test Utilities
  // ---------------------------------------------------------------------------

  /**
   * Clear all stored data.
   *
   * Call in beforeEach() to reset state between tests.
   */
  clear(): void {
    this.clients.clear();
    this.grants.clear();
    this.tokens.clear();
  }

  /**
   * Seed storage with test data.
   *
   * @param data - Data to seed
   */
  seed(data: {
    clients?: ClientInfo[];
    grants?: Array<{ grant: Grant; ttl?: number }>;
    tokens?: Array<{ token: Token; ttl: number }>;
  }): void {
    if (data.clients) {
      for (const client of data.clients) {
        this.clients.set(client.clientId, client);
      }
    }

    if (data.grants) {
      for (const { grant, ttl } of data.grants) {
        const key = `${grant.userId}:${grant.id}`;
        const expiresAt = ttl ? Date.now() + ttl * 1000 : undefined;
        this.grants.set(key, { grant, expiresAt });
      }
    }

    if (data.tokens) {
      for (const { token, ttl } of data.tokens) {
        const key = `${token.userId}:${token.grantId}:${token.id}`;
        const expiresAt = Date.now() + ttl * 1000;
        this.tokens.set(key, { token, expiresAt });
      }
    }
  }

  /**
   * Get a snapshot of all stored data for assertions.
   */
  snapshot(): {
    clients: ClientInfo[];
    grants: Grant[];
    tokens: Token[];
  } {
    return {
      clients: Array.from(this.clients.values()),
      grants: Array.from(this.grants.values()).map((e) => e.grant),
      tokens: Array.from(this.tokens.values()).map((e) => e.token),
    };
  }

  /**
   * Get count of each entity type.
   */
  counts(): { clients: number; grants: number; tokens: number } {
    return {
      clients: this.clients.size,
      grants: this.grants.size,
      tokens: this.tokens.size,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private paginate<T>(items: T[], options?: ListOptions): ListResult<T> {
    // Simple pagination using array index as cursor
    const limit = options?.limit ?? items.length;
    const offset = options?.cursor ? Number.parseInt(options.cursor, 10) : 0;

    const page = items.slice(offset, offset + limit);
    const hasMore = offset + limit < items.length;

    return {
      items: page,
      cursor: hasMore ? String(offset + limit) : undefined,
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a KV storage instance.
 *
 * @param kv - Cloudflare KV namespace
 * @returns Storage instance
 */
export function createKVStorage(kv: KVNamespace): OAuthStorage {
  return new KVStorage(kv);
}

/**
 * Create an in-memory storage instance for testing.
 *
 * @returns Storage instance
 */
export function createInMemoryStorage(): InMemoryStorage {
  return new InMemoryStorage();
}
