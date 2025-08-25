/**
 * User Consent Management for OAuth 2.1
 * 
 * Implements persistent consent storage to improve user experience by remembering
 * previously granted permissions. This allows users to skip the consent screen
 * for trusted applications they've already authorized.
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-10.2 - Client Impersonation
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-9.1 - Security Considerations
 */

import type { Storage } from '../types';

/**
 * User consent record for a client application
 * 
 * Stores user's authorization decision for a specific client and scope combination.
 * Consents have configurable expiration to balance security and user experience.
 */
export interface UserConsent {
  /** Unique consent identifier */
  id: string;
  /** User who granted consent */
  userId: string;
  /** Client application that received consent */
  clientId: string;
  /** Scopes that were authorized */
  scope: string;
  /** When consent was first granted */
  grantedAt: number;
  /** When consent expires (optional, for limited-time consents) */
  expiresAt?: number;
  /** When consent was last used */
  lastUsedAt: number;
  /** Number of times this consent has been used */
  useCount: number;
  /** Whether consent can be automatically renewed */
  autoRenew: boolean;
  /** IP address where consent was granted (for audit) */
  grantedFromIp?: string;
}

/**
 * Options for consent management
 */
export interface ConsentOptions {
  /** Default consent lifetime in milliseconds (default: 90 days) */
  defaultLifetime?: number;
  /** Maximum consent lifetime in milliseconds (default: 1 year) */
  maxLifetime?: number;
  /** Whether to auto-renew consent on use (default: true) */
  autoRenewOnUse?: boolean;
  /** Whether to require re-consent for scope changes (default: true) */
  requireReconsentForScopeChange?: boolean;
}

// Default consent lifetimes
const DEFAULT_CONSENT_LIFETIME = 90 * 24 * 60 * 60 * 1000; // 90 days
const MAX_CONSENT_LIFETIME = 365 * 24 * 60 * 60 * 1000; // 1 year

/**
 * Consent Manager - Handles user consent storage and validation
 * 
 * Provides methods to:
 * - Check if a user has previously consented to a client
 * - Store new consent decisions
 * - Revoke existing consents
 * - Clean up expired consents
 */
export class ConsentManager {
  private storage: Storage;
  private options: Required<ConsentOptions>;

  constructor(storage: Storage, options: ConsentOptions = {}) {
    this.storage = storage;
    this.options = {
      defaultLifetime: options.defaultLifetime ?? DEFAULT_CONSENT_LIFETIME,
      maxLifetime: options.maxLifetime ?? MAX_CONSENT_LIFETIME,
      autoRenewOnUse: options.autoRenewOnUse ?? true,
      requireReconsentForScopeChange: options.requireReconsentForScopeChange ?? true,
    };
  }

  /**
   * Generate storage key for consent
   */
  private getConsentKey(userId: string, clientId: string): string {
    return `consent:${userId}:${clientId}`;
  }

  /**
   * Check if user has valid consent for a client and scope
   * 
   * @param userId - The user to check consent for
   * @param clientId - The client requesting authorization
   * @param requestedScope - The scope being requested
   * @returns The consent if valid, null otherwise
   */
  async checkConsent(
    userId: string,
    clientId: string,
    requestedScope: string
  ): Promise<UserConsent | null> {
    const key = this.getConsentKey(userId, clientId);
    const consent = await this.storage.get<UserConsent>(key, { type: 'json' });

    if (!consent) {
      return null;
    }

    // Check if consent has expired
    if (consent.expiresAt && Date.now() > consent.expiresAt) {
      // Clean up expired consent
      await this.storage.delete(key);
      return null;
    }

    // Check if requested scope is covered by existing consent
    const grantedScopes = new Set(consent.scope.split(' '));
    const requestedScopes = new Set(requestedScope.split(' '));
    
    // All requested scopes must be in granted scopes
    for (const scope of requestedScopes) {
      if (!grantedScopes.has(scope)) {
        // New scope requested - require re-consent if configured
        if (this.options.requireReconsentForScopeChange) {
          return null;
        }
      }
    }

    // Update last used time and use count if auto-renew is enabled
    if (this.options.autoRenewOnUse) {
      const now = Date.now();
      consent.lastUsedAt = now;
      consent.useCount = (consent.useCount || 0) + 1;

      // Extend expiration if within renewal window
      if (consent.expiresAt) {
        const timeUntilExpiry = consent.expiresAt - now;
        const renewalWindow = this.options.defaultLifetime / 2; // Renew if less than half lifetime remaining
        
        if (timeUntilExpiry < renewalWindow && consent.autoRenew) {
          consent.expiresAt = Math.min(
            now + this.options.defaultLifetime,
            consent.grantedAt + this.options.maxLifetime
          );
        }
      }

      // Save updated consent
      await this.storage.put(key, JSON.stringify(consent));
    }

    return consent;
  }

  /**
   * Store user consent for a client
   * 
   * @param userId - The user granting consent
   * @param clientId - The client receiving consent
   * @param scope - The scope being authorized
   * @param options - Additional consent options
   */
  async grantConsent(
    userId: string,
    clientId: string,
    scope: string,
    options: {
      lifetime?: number;
      autoRenew?: boolean;
      ipAddress?: string;
    } = {}
  ): Promise<UserConsent> {
    const now = Date.now();
    const lifetime = Math.min(
      options.lifetime ?? this.options.defaultLifetime,
      this.options.maxLifetime
    );

    const consent: UserConsent = {
      id: `consent_${crypto.randomUUID()}`,
      userId,
      clientId,
      scope,
      grantedAt: now,
      expiresAt: now + lifetime,
      lastUsedAt: now,
      useCount: 1,
      autoRenew: options.autoRenew ?? true,
      grantedFromIp: options.ipAddress,
    };

    const key = this.getConsentKey(userId, clientId);
    await this.storage.put(key, JSON.stringify(consent));

    // Log consent grant for audit
    console.log('[OAuth] Consent granted:', {
      userId,
      clientId,
      scope,
      expiresAt: new Date(consent.expiresAt!).toISOString(),
      ipAddress: options.ipAddress,
    });

    return consent;
  }

  /**
   * Revoke user consent for a client
   * 
   * @param userId - The user revoking consent
   * @param clientId - The client to revoke consent for
   */
  async revokeConsent(userId: string, clientId: string): Promise<void> {
    const key = this.getConsentKey(userId, clientId);
    const consent = await this.storage.get<UserConsent>(key, { type: 'json' });
    
    if (consent) {
      await this.storage.delete(key);
      
      // Log consent revocation for audit
      console.log('[OAuth] Consent revoked:', {
        userId,
        clientId,
        scope: consent.scope,
        grantedAt: new Date(consent.grantedAt).toISOString(),
      });
    }
  }

  /**
   * List all consents for a user
   * 
   * @param userId - The user to list consents for
   * @returns Array of active consents
   */
  async listUserConsents(userId: string): Promise<UserConsent[]> {
    const prefix = `consent:${userId}:`;
    const { keys } = await this.storage.list({ prefix });
    
    const consents: UserConsent[] = [];
    for (const { name } of keys) {
      const consent = await this.storage.get<UserConsent>(name, { type: 'json' });
      if (consent && (!consent.expiresAt || consent.expiresAt > Date.now())) {
        consents.push(consent);
      }
    }
    
    return consents;
  }

  /**
   * Revoke all consents for a user
   * 
   * @param userId - The user to revoke all consents for
   */
  async revokeAllUserConsents(userId: string): Promise<void> {
    const consents = await this.listUserConsents(userId);
    
    for (const consent of consents) {
      await this.revokeConsent(userId, consent.clientId);
    }
    
    console.log('[OAuth] All consents revoked for user:', {
      userId,
      count: consents.length,
    });
  }

  /**
   * Clean up expired consents (maintenance task)
   * 
   * @returns Number of expired consents removed
   */
  async cleanupExpiredConsents(): Promise<number> {
    const { keys } = await this.storage.list({ prefix: 'consent:' });
    const now = Date.now();
    let cleaned = 0;
    
    for (const { name } of keys) {
      const consent = await this.storage.get<UserConsent>(name, { type: 'json' });
      if (consent && consent.expiresAt && consent.expiresAt < now) {
        await this.storage.delete(name);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log('[OAuth] Cleaned up expired consents:', { count: cleaned });
    }
    
    return cleaned;
  }
}