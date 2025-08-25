/**
 * Storage Interface
 * 
 * Mirrors Cloudflare KV interface exactly, allowing different implementations
 * for production (Cloudflare KV) and testing (in-memory).
 */

export interface Storage {
  /**
   * Get a value from storage
   */
  get(key: string): Promise<string | null>;
  get<T>(key: string, options: { type: "json" }): Promise<T | null>;
  
  /**
   * Put a value into storage
   */
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  
  /**
   * Delete a value from storage
   */
  delete(key: string): Promise<void>;
  
  /**
   * List keys with a prefix
   */
  list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }>;
}

/**
 * Cloudflare KV implementation - just passes through to actual KV
 */
export class CloudflareStorage implements Storage {
  constructor(private kv: KVNamespace) {}
  
  get(key: string): Promise<string | null>;
  get<T>(key: string, options: { type: "json" }): Promise<T | null>;
  get(key: string, options?: any): Promise<any> {
    return this.kv.get(key, options);
  }
  
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    return this.kv.put(key, value, options);
  }
  
  delete(key: string): Promise<void> {
    return this.kv.delete(key);
  }
  
  list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }> {
    return this.kv.list(options);
  }
}

/**
 * In-memory storage for testing
 */
export class InMemoryStorage implements Storage {
  private store = new Map<string, { value: string; expiresAt?: number }>();
  
  get(key: string): Promise<string | null>;
  get<T>(key: string, options: { type: "json" }): Promise<T | null>;
  async get(key: string, options?: { type?: string }): Promise<any> {
    const item = this.store.get(key);
    
    if (!item) {
      return null;
    }
    
    // Check expiration
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    
    if (options?.type === "json") {
      try {
        return JSON.parse(item.value);
      } catch {
        return null;
      }
    }
    
    return item.value;
  }
  
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const item: { value: string; expiresAt?: number } = { value };
    
    if (options?.expirationTtl) {
      item.expiresAt = Date.now() + (options.expirationTtl * 1000);
      
      // Set timeout to clean up expired item
      setTimeout(() => {
        const stored = this.store.get(key);
        if (stored?.expiresAt && Date.now() > stored.expiresAt) {
          this.store.delete(key);
        }
      }, options.expirationTtl * 1000);
    }
    
    this.store.set(key, item);
  }
  
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  
  async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }> {
    const keys: Array<{ name: string }> = [];
    for (const [key] of this.store.entries()) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        keys.push({ name: key });
      }
    }
    return { keys };
  }
  
  // Additional methods for testing
  
  /**
   * Clear all data (useful for test cleanup)
   */
  clear(): void {
    this.store.clear();
  }
  
  /**
   * Get all stored data (useful for test assertions)
   */
  getAll(): Map<string, any> {
    const result = new Map<string, any>();
    for (const [key, item] of this.store.entries()) {
      if (!item.expiresAt || Date.now() <= item.expiresAt) {
        try {
          result.set(key, JSON.parse(item.value));
        } catch {
          result.set(key, item.value);
        }
      }
    }
    return result;
  }
}