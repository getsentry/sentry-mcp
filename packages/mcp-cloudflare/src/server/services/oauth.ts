/**
 * OAuth Service for Hono
 * 
 * This service handles OAuth operations using an abstract storage layer.
 * It provides methods for token validation, client management, and authorization.
 */

import type { ClientInfo, Grant, Token } from "@sentry/hono-oauth-provider";
import type { WorkerProps } from "../types";
import type { Storage } from "./storage-interface";
import { CloudflareStorage } from "./storage-interface";

export interface OAuthService {
  /**
   * Validates an access token and returns the associated user properties
   */
  validateToken(token: string): Promise<WorkerProps | null>;
  
  /**
   * Gets client information by ID
   */
  getClient(clientId: string): Promise<ClientInfo | null>;
  
  /**
   * Creates a new grant for user authorization
   */
  createGrant(userId: string, clientId: string, scope: string): Promise<Grant>;
  
  /**
   * Exchanges an authorization code for an access token
   */
  exchangeCode(code: string, clientId: string): Promise<Token | null>;
  
  /**
   * Revokes a grant and all associated tokens
   */
  revokeGrant(grantId: string, userId: string): Promise<void>;
  
  /**
   * Registers a new OAuth client
   */
  registerClient(client: ClientInfo): Promise<void>;
}

/**
 * Implementation of OAuth service using abstract storage
 */
export class CloudflareOAuthService implements OAuthService {
  private storage: Storage;
  
  constructor(
    storageOrKV: Storage | KVNamespace,
    private encryptionKey: CryptoKey | null = null
  ) {
    // Support both direct storage adapter and Cloudflare KV
    if ('getWithMetadata' in storageOrKV) {
      // It's a KVNamespace, wrap it
      this.storage = new CloudflareStorage(storageOrKV as KVNamespace);
    } else {
      // It's already a Storage implementation
      this.storage = storageOrKV as Storage;
    }
  }
  
  /**
   * Initialize encryption key if not provided
   */
  private async getEncryptionKey(): Promise<CryptoKey> {
    if (!this.encryptionKey) {
      // Generate a key from environment or use a default
      // In production, this should come from environment secrets
      const keyMaterial = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode("oauth-encryption-key") // TODO: Use env.OAUTH_ENCRYPTION_SECRET
      );
      
      this.encryptionKey = await crypto.subtle.importKey(
        "raw",
        keyMaterial,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
      );
    }
    return this.encryptionKey;
  }
  
  /**
   * Encrypts sensitive data before storing in KV
   */
  private async encrypt(data: any): Promise<string> {
    const key = await this.getEncryptionKey();
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );
    
    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    return btoa(String.fromCharCode(...combined));
  }
  
  /**
   * Decrypts data retrieved from KV
   */
  private async decrypt(encryptedData: string): Promise<any> {
    const key = await this.getEncryptionKey();
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
    
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );
    
    return JSON.parse(new TextDecoder().decode(decrypted));
  }
  
  /**
   * Generates a unique ID
   */
  private generateId(): string {
    return crypto.randomUUID();
  }
  
  /**
   * Hashes a token for storage as a key
   */
  private async hashToken(token: string): Promise<string> {
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(token)
    );
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }
  
  async validateToken(token: string): Promise<WorkerProps | null> {
    try {
      // Parse the token to extract components
      const [userId, grantId, tokenId] = token.split(".");
      if (!userId || !grantId || !tokenId) {
        return null;
      }
      
      // Hash the token ID for lookup
      const hashedTokenId = await this.hashToken(tokenId);
      const tokenKey = `token:${userId}:${grantId}:${hashedTokenId}`;
      
      // Retrieve and decrypt token data
      const encryptedData = await this.storage.get(tokenKey);
      if (!encryptedData) {
        return null;
      }
      
      const tokenData = await this.decrypt(encryptedData);
      
      // Check expiration
      if (tokenData.expiresAt && Date.now() > tokenData.expiresAt) {
        // Token expired, delete it
        await this.storage.delete(tokenKey);
        return null;
      }
      
      // Return user properties
      return tokenData.props as WorkerProps;
    } catch (error) {
      console.error("Token validation error:", error);
      return null;
    }
  }
  
  async getClient(clientId: string): Promise<ClientInfo | null> {
    const clientKey = `client:${clientId}`;
    const clientData = await this.storage.get<ClientInfo>(clientKey, { type: "json" });
    return clientData;
  }
  
  async createGrant(userId: string, clientId: string, scope: string): Promise<Grant> {
    const grantId = this.generateId();
    const code = this.generateId();
    const hashedCode = await this.hashToken(code);
    
    const grant: Grant = {
      id: grantId,
      userId,
      clientId,
      scope,
      code,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600000, // 10 minutes
    };
    
    // Store grant with hashed code as key
    const grantKey = `grant:${userId}:${grantId}`;
    const codeKey = `code:${hashedCode}`;
    
    // Store encrypted grant data
    const encryptedGrant = await this.encrypt(grant);
    
    // Store both grant and code reference
    await Promise.all([
      this.storage.put(grantKey, encryptedGrant, {
        expirationTtl: 600, // 10 minutes
      }),
      this.storage.put(codeKey, JSON.stringify({ userId, grantId }), {
        expirationTtl: 600, // 10 minutes
      }),
    ]);
    
    return grant;
  }
  
  async exchangeCode(code: string, clientId: string): Promise<Token | null> {
    try {
      // Hash the code for lookup
      const hashedCode = await this.hashToken(code);
      const codeKey = `code:${hashedCode}`;
      
      // Get grant reference from code
      const codeData = await this.storage.get<{ userId: string; grantId: string }>(codeKey, { type: "json" });
      if (!codeData) {
        return null;
      }
      
      const { userId, grantId } = codeData;
      
      // Get and decrypt grant
      const grantKey = `grant:${userId}:${grantId}`;
      const encryptedGrant = await this.storage.get(grantKey);
      if (!encryptedGrant) {
        return null;
      }
      
      const grant = await this.decrypt(encryptedGrant) as Grant;
      
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
      const hashedTokenId = await this.hashToken(tokenId);
      
      // Create token data (this would include the actual Sentry API token)
      const tokenData = {
        props: {
          id: userId,
          accessToken: grant.scope, // This should be the actual Sentry API token
          name: "User", // This should come from the grant
          scope: grant.scope,
        },
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000, // 1 hour
      };
      
      // Store encrypted token
      const tokenKey = `token:${userId}:${grantId}:${hashedTokenId}`;
      await this.storage.put(tokenKey, await this.encrypt(tokenData), {
        expirationTtl: 3600, // 1 hour
      });
      
      // Delete the used authorization code
      await this.storage.delete(codeKey);
      
      return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 3600,
        scope: grant.scope,
      };
    } catch (error) {
      console.error("Code exchange error:", error);
      return null;
    }
  }
  
  async revokeGrant(grantId: string, userId: string): Promise<void> {
    // Delete grant and all associated tokens
    const grantKey = `grant:${userId}:${grantId}`;
    
    // List all tokens for this grant (would need to implement token tracking)
    // For now, just delete the grant
    await this.storage.delete(grantKey);
    
    // In a full implementation, we'd track all tokens per grant
    // and delete them here
  }
  
  async registerClient(client: ClientInfo): Promise<void> {
    const clientKey = `client:${client.id}`;
    await this.storage.put(clientKey, JSON.stringify(client));
  }
}

/**
 * Factory function to create OAuth service from Hono context
 */
export function createOAuthService(storageOrKV: Storage | KVNamespace): OAuthService {
  return new CloudflareOAuthService(storageOrKV);
}