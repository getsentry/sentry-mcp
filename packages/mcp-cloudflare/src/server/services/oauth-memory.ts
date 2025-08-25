/**
 * In-Memory OAuth Service for Testing
 * 
 * This implementation stores all data in memory, making it perfect for testing
 * without requiring Cloudflare KV.
 */

import type { ClientInfo } from "@sentry/hono-oauth-provider";
import type { WorkerProps } from "../types";
import type { OAuthService, Grant, Token } from "./oauth-interface";

export class InMemoryOAuthService implements OAuthService {
  private tokens = new Map<string, { props: WorkerProps; expiresAt: number }>();
  private clients = new Map<string, ClientInfo>();
  private grants = new Map<string, Grant>();
  private codes = new Map<string, { userId: string; grantId: string }>();
  
  constructor(initialData?: {
    tokens?: Array<[string, { props: WorkerProps; expiresAt: number }]>;
    clients?: Array<[string, ClientInfo]>;
  }) {
    if (initialData?.tokens) {
      this.tokens = new Map(initialData.tokens);
    }
    if (initialData?.clients) {
      this.clients = new Map(initialData.clients);
    }
  }
  
  private generateId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
  
  async validateToken(token: string): Promise<WorkerProps | null> {
    const tokenData = this.tokens.get(token);
    
    if (!tokenData) {
      return null;
    }
    
    // Check expiration
    if (tokenData.expiresAt && Date.now() > tokenData.expiresAt) {
      this.tokens.delete(token);
      return null;
    }
    
    return tokenData.props;
  }
  
  async getClient(clientId: string): Promise<ClientInfo | null> {
    return this.clients.get(clientId) || null;
  }
  
  async createGrant(userId: string, clientId: string, scope: string): Promise<Grant> {
    const grantId = this.generateId();
    const code = this.generateId();
    
    const grant: Grant = {
      id: grantId,
      userId,
      clientId,
      scope,
      code,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600000, // 10 minutes
    };
    
    // Store grant
    this.grants.set(grantId, grant);
    this.codes.set(code, { userId, grantId });
    
    // Clean up expired code after 10 minutes
    setTimeout(() => {
      this.codes.delete(code);
    }, 600000);
    
    return grant;
  }
  
  async exchangeCode(code: string, clientId: string): Promise<Token | null> {
    const codeData = this.codes.get(code);
    if (!codeData) {
      return null;
    }
    
    const { userId, grantId } = codeData;
    const grant = this.grants.get(grantId);
    
    if (!grant) {
      return null;
    }
    
    // Verify client ID matches
    if (grant.clientId !== clientId) {
      return null;
    }
    
    // Check if code is expired
    if (grant.expiresAt && Date.now() > grant.expiresAt) {
      return null;
    }
    
    // Generate access token
    const tokenId = this.generateId();
    const accessToken = `${userId}.${grantId}.${tokenId}`;
    
    // Store token with user props (simplified for testing)
    this.tokens.set(accessToken, {
      props: {
        id: userId,
        accessToken: "test-sentry-token", // Mock Sentry API token
        name: "Test User",
        scope: grant.scope,
      },
      expiresAt: Date.now() + 3600000, // 1 hour
    });
    
    // Delete used code
    this.codes.delete(code);
    
    // Clean up token after expiration
    setTimeout(() => {
      this.tokens.delete(accessToken);
    }, 3600000);
    
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: grant.scope,
    };
  }
  
  async revokeGrant(grantId: string, userId: string): Promise<void> {
    const grant = this.grants.get(grantId);
    if (grant && grant.userId === userId) {
      this.grants.delete(grantId);
      
      // Revoke all tokens for this grant
      for (const [token, data] of this.tokens.entries()) {
        if (token.includes(grantId)) {
          this.tokens.delete(token);
        }
      }
    }
  }
  
  async registerClient(client: ClientInfo): Promise<void> {
    this.clients.set(client.id, client);
  }
  
  // Additional methods for testing
  
  /**
   * Add a test token directly (useful for testing authenticated endpoints)
   */
  addTestToken(token: string, props: WorkerProps, expiresIn = 3600000): void {
    this.tokens.set(token, {
      props,
      expiresAt: Date.now() + expiresIn,
    });
  }
  
  /**
   * Clear all data (useful for test cleanup)
   */
  clear(): void {
    this.tokens.clear();
    this.clients.clear();
    this.grants.clear();
    this.codes.clear();
  }
  
  /**
   * Get current state (useful for test assertions)
   */
  getState() {
    return {
      tokens: Array.from(this.tokens.entries()),
      clients: Array.from(this.clients.entries()),
      grants: Array.from(this.grants.entries()),
      codes: Array.from(this.codes.entries()),
    };
  }
}