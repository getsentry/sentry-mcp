/**
 * Tests for race condition prevention in OAuth 2.1 provider
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { OAuthProviderTestWrapper as OAuthProvider } from '../test-helpers';
import type { Storage, Client } from '../../types';

// Test storage that can simulate race conditions
class RaceTestStorage implements Storage {
  private store = new Map<string, any>();
  private deleteCount = 0;
  public simulateRace = false;
  public accessCount = 0;

  async get(key: string): Promise<string | null>;
  async get<T>(key: string, options: { type: 'json' }): Promise<T | null>;
  async get(key: string, options?: { type?: string }): Promise<any> {
    this.accessCount++;
    
    // For grant keys, simulate atomic get-and-delete behavior
    // Once a grant is accessed, mark it as "being deleted"
    if (key.startsWith('grant:') && this.simulateRace) {
      const value = this.store.get(key);
      if (!value) return null;
      
      // Check if this grant is already being processed
      const processingKey = `_processing_${key}`;
      if (this.store.has(processingKey)) {
        // Another request is already processing this grant
        return null;
      }
      
      // Mark as being processed
      this.store.set(processingKey, true);
      
      if (options?.type === 'json') {
        return typeof value === 'string' ? JSON.parse(value) : value;
      }
      return value;
    }
    
    // Normal get behavior for other keys
    const value = this.store.get(key);
    if (!value) return null;
    
    if (options?.type === 'json') {
      return typeof value === 'string' ? JSON.parse(value) : value;
    }
    return value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.deleteCount++;
    
    // Check if already deleted (for atomic behavior)
    if (!this.store.has(key)) {
      return;
    }
    
    if (this.simulateRace && this.deleteCount === 1) {
      // Simulate delay on first delete to allow second request through
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    this.store.delete(key);
  }

  async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }> {
    const keys = Array.from(this.store.keys())
      .filter(k => !options?.prefix || k.startsWith(options.prefix))
      .map(name => ({ name }));
    return { keys };
  }

  getDeleteCount() {
    return this.deleteCount;
  }

  resetCounters() {
    this.deleteCount = 0;
    this.accessCount = 0;
  }
}

describe('Race Condition Prevention', () => {
  let storage: RaceTestStorage;
  let provider: OAuthProvider;
  let app: Hono;

  beforeEach(() => {
    storage = new RaceTestStorage();
    provider = new OAuthProvider({
      storage,
      issuer: 'http://localhost:8787',
      scopesSupported: ['read', 'write'],
      strictMode: true,
    });
    app = provider.getApp();
  });

  it('should prevent authorization code reuse in concurrent requests', async () => {
    // Setup client
    const client: Client = {
      id: 'test-client',
      secret: 'test-secret',
      name: 'Test Client',
      redirectUris: ['http://localhost:3000/callback'],
    };
    await storage.put('client:test-client', JSON.stringify(client));

    // Create a valid grant
    const code = 'test-code-123';
    const grant = {
      id: 'grant-123',
      clientId: 'test-client',
      userId: 'user-1',
      scope: 'read',
      code,
      expiresAt: Date.now() + 600000,
    };
    await storage.put(`grant:${code}`, JSON.stringify(grant));

    // Enable race simulation
    storage.simulateRace = true;
    storage.resetCounters();

    // Simulate two concurrent token exchange requests
    const request1 = app.request('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: 'test-client',
        client_secret: 'test-secret',
      }).toString(),
    });

    const request2 = app.request('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: 'test-client',
        client_secret: 'test-secret',
      }).toString(),
    });

    // Execute both requests concurrently
    const [response1, response2] = await Promise.all([request1, request2]);
    
    // One should succeed, one should fail
    const statuses = [response1.status, response2.status].sort();
    expect(statuses).toEqual([200, 400]);

    // The successful response should have tokens
    const successResponse = response1.status === 200 ? response1 : response2;
    const failResponse = response1.status === 400 ? response1 : response2;
    
    const successData = await successResponse.json() as any;
    expect(successData.access_token).toBeDefined();
    expect(successData.refresh_token).toBeDefined();

    const failData = await failResponse.json() as any;
    expect(failData.error).toBe('invalid_grant');

    // Code should be deleted exactly once (not twice)
    expect(storage.getDeleteCount()).toBe(1);
  });

  it('should handle validation failures without deleting valid codes prematurely', async () => {
    // Setup two different clients
    const client1: Client = {
      id: 'client-1',
      secret: 'secret-1',
      name: 'Client 1',
      redirectUris: ['http://localhost:3000/callback'],
    };
    const client2: Client = {
      id: 'client-2',
      secret: 'secret-2',
      name: 'Client 2',
      redirectUris: ['http://localhost:4000/callback'],
    };
    
    await storage.put('client:client-1', JSON.stringify(client1));
    await storage.put('client:client-2', JSON.stringify(client2));

    // Create a grant for client-1
    const code = 'secure-code-456';
    const grant = {
      id: 'grant-456',
      clientId: 'client-1',
      userId: 'user-1',
      scope: 'read',
      code,
      expiresAt: Date.now() + 600000,
    };
    await storage.put(`grant:${code}`, JSON.stringify(grant));

    storage.resetCounters();

    // Try to exchange the code with wrong client (client-2)
    const response = await app.request('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: 'client-2',
        client_secret: 'secret-2',
      }).toString(),
    });

    expect(response.status).toBe(400);
    const data = await response.json() as any;
    expect(data.error).toBe('invalid_grant');

    // Code should be deleted on client mismatch (potential attack)
    expect(storage.getDeleteCount()).toBe(1);

    // Verify code is actually deleted
    const deletedGrant = await storage.get(`grant:${code}`, { type: 'json' });
    expect(deletedGrant).toBeNull();
  });

  it('should delete expired codes when validation fails', async () => {
    const client: Client = {
      id: 'test-client',
      secret: 'test-secret',
      name: 'Test Client',
      redirectUris: ['http://localhost:3000/callback'],
    };
    await storage.put('client:test-client', JSON.stringify(client));

    // Create an expired grant
    const code = 'expired-code-789';
    const grant = {
      id: 'grant-789',
      clientId: 'test-client',
      userId: 'user-1',
      scope: 'read',
      code,
      expiresAt: Date.now() - 1000, // Already expired
    };
    await storage.put(`grant:${code}`, JSON.stringify(grant));

    storage.resetCounters();

    const response = await app.request('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: 'test-client',
        client_secret: 'test-secret',
      }).toString(),
    });

    expect(response.status).toBe(400);
    const data = await response.json() as any;
    expect(data.error).toBe('invalid_grant');

    // Expired code should be deleted
    expect(storage.getDeleteCount()).toBe(1);
    
    // Verify code is actually deleted
    const deletedGrant = await storage.get(`grant:${code}`, { type: 'json' });
    expect(deletedGrant).toBeNull();
  });

  it('should handle successful validation and delete code only once', async () => {
    const client: Client = {
      id: 'test-client',
      secret: 'test-secret',
      name: 'Test Client',
      redirectUris: ['http://localhost:3000/callback'],
    };
    await storage.put('client:test-client', JSON.stringify(client));

    const code = 'valid-code-321';
    const grant = {
      id: 'grant-321',
      clientId: 'test-client',
      userId: 'user-1',
      scope: 'read',
      code,
      expiresAt: Date.now() + 600000,
    };
    await storage.put(`grant:${code}`, JSON.stringify(grant));

    storage.resetCounters();

    const response = await app.request('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: 'test-client',
        client_secret: 'test-secret',
      }).toString(),
    });

    expect(response.status).toBe(200);
    const data = await response.json() as any;
    expect(data.access_token).toBeDefined();

    // Code should be deleted exactly once after successful validation
    expect(storage.getDeleteCount()).toBe(1);
    
    // Verify code is deleted
    const deletedGrant = await storage.get(`grant:${code}`, { type: 'json' });
    expect(deletedGrant).toBeNull();
  });
});