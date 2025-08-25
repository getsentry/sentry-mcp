/**
 * Modular OAuth 2.1 Provider
 * 
 * A clean, modular implementation of an OAuth 2.1 authorization server
 * with handlers separated by concern.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Context } from 'hono';
import type { OAuth21Config, Storage } from './types';
import { ConsentManager } from './core/consent';
import { parseStructuredToken, hashToken } from './lib/utils';
import { decryptContextFromStorage } from './lib/crypto-context';

// Import handlers
import { AuthorizeHandler } from './handlers/authorize';
import { TokenHandler } from './handlers/token';
import { RevokeHandler } from './handlers/revoke';
import { IntrospectHandler } from './handlers/introspect';
import { RegisterHandler } from './handlers/register';
import { DiscoveryHandler } from './handlers/discovery';
import { ConsentsHandler } from './handlers/consents';

/**
 * OAuth 2.1 Authorization Server Middleware
 * 
 * Implements a complete OAuth 2.1 authorization server as Hono middleware with:
 * - Authorization code flow with PKCE
 * - Dynamic client registration
 * - Refresh token rotation
 * - Bearer token validation
 * - OAuth 2.0 discovery metadata
 * - User consent management
 * 
 * @example
 * ```typescript
 * import { OAuthProvider } from '@sentry/hono-oauth-provider';
 * 
 * // Create OAuth provider instance
 * const oauth = new OAuthProvider({
 *   storage: kvStorage,
 *   issuer: 'https://api.example.com',
 *   scopesSupported: ['read', 'write'],
 *   strictMode: true,
 * });
 * 
 * // Use directly as Hono middleware
 * app.use('*', oauth);
 * 
 * // Protected routes automatically get user context
 * app.get('/api/profile', (c) => {
 *   const user = c.get('user');
 *   return c.json({ userId: user.userId });
 * });
 * ```
 */
export function OAuthProvider(config: OAuth21Config) {
  const app = new Hono();
  const consentManager = new ConsentManager(config.storage);
  
  // Initialize handlers
  const authorizeHandler = new AuthorizeHandler(
    config.storage, 
    config, 
    consentManager
  );
  const tokenHandler = new TokenHandler(config.storage, config);
  const revokeHandler = new RevokeHandler(config.storage, config);
  const introspectHandler = new IntrospectHandler(config.storage, config);
  const registerHandler = new RegisterHandler(config.storage, config);
  const discoveryHandler = new DiscoveryHandler(config);
  const consentsHandler = new ConsentsHandler(
    config.storage, 
    config, 
    consentManager
  );

  // Setup OAuth routes
  app.use('*', cors());

  // Discovery endpoint
  app.get('/.well-known/oauth-authorization-server', (c) => 
    discoveryHandler.handle(c)
  );

  // Authorization endpoints
  app.get('/authorize', (c) => authorizeHandler.handleGet(c));
  app.post('/authorize', (c) => authorizeHandler.handlePost(c));

  // Token endpoint
  app.post('/token', (c) => tokenHandler.handle(c));
  
  // Token revocation endpoint (RFC 7009)
  app.post('/revoke', (c) => revokeHandler.handle(c));
  
  // Token introspection endpoint (RFC 7662)
  app.post('/introspect', (c) => introspectHandler.handle(c));

  // Client registration
  app.post('/register', (c) => registerHandler.handle(c));
  
  // Consent management endpoints
  app.get('/consents', (c) => consentsHandler.list(c));
  app.delete('/consents/:clientId', (c) => consentsHandler.revoke(c));
  app.delete('/consents', (c) => consentsHandler.revokeAll(c));

  // Create the middleware function
  const middleware = async (c: Context, next: () => Promise<void>) => {
    const path = new URL(c.req.url).pathname;
    
    // Check if this is an OAuth endpoint
    const oauthPaths = [
      '/authorize',
      '/token',
      '/register',
      '/revoke',
      '/introspect',
      '/consents',
      '/.well-known/oauth-authorization-server'
    ];
    
    if (oauthPaths.some(p => path.startsWith(p))) {
      // Pass through to OAuth provider app
      // In test environments, executionCtx might not be available
      let executionCtx;
      try {
        executionCtx = c.executionCtx;
      } catch (e) {
        // In test environment, executionCtx getter might throw
        executionCtx = {
          waitUntil: () => {},
          passThroughOnException: () => {},
          props: {} // Add props to satisfy ExecutionContext type
        } as any;
      }
      return app.fetch(c.req.raw, c.env, executionCtx);
    }
    
    // For other routes, check for Bearer token
    const auth = c.req.header('Authorization');
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.substring(7);
      
      // Parse and validate structured token format
      const parsed = parseStructuredToken(token);
      if (!parsed) {
        return c.json({ 
          error: 'invalid_token',
          error_description: 'Token format is invalid'
        }, 401);
      }
      
      // Hash token for storage lookup
      const tokenHash = await hashToken(token);
      const tokenData = await config.storage.get<any>(
        `token:${tokenHash}`,
        { type: 'json' }
      );
      
      if (tokenData && Date.now() < tokenData.expiresAt) {
        // Validate that token components match stored data
        if (tokenData.userId !== parsed.userId || tokenData.grantId !== parsed.grantId) {
          return c.json({ 
            error: 'invalid_token',
            error_description: 'Token validation failed'
          }, 401);
        }
        
        // Decrypt context if it exists (for OAuth proxy functionality)
        let decryptedContext = null;
        if (tokenData.encryptedContext && tokenData.wrappedKey && tokenData.iv) {
          try {
            decryptedContext = await decryptContextFromStorage(
              tokenData.encryptedContext,
              tokenData.wrappedKey,
              tokenData.iv,
              token // Use the full token to unwrap the key
            );
          } catch (error) {
            console.error('[OAuth] Failed to decrypt context:', error);
            // Continue without context - don't fail the request
          }
        }
        
        // Inject user, oauth helpers, and context into Hono context
        c.set('user', {
          userId: tokenData.userId,
          clientId: tokenData.clientId,
          scope: tokenData.scope,
        });
        
        c.set('oauth', {
          scope: tokenData.scope,
          checkScope: (requiredScope: string) => {
            const granted = new Set(tokenData.scope.split(' '));
            const required = requiredScope.split(' ');
            return required.every((scope: string) => granted.has(scope));
          }
        });
        
        // Inject decrypted context for OAuth proxy functionality
        if (decryptedContext) {
          c.set('oauthContext', decryptedContext);
        }
      } else if (auth) {
        // Token provided but invalid/expired
        return c.json({ 
          error: 'invalid_token',
          error_description: 'The access token is invalid or expired'
        }, 401);
      }
    }
    
    await next();
  };
  
  return middleware;
}

/**
 * Middleware to require OAuth authentication with specific scopes
 * 
 * Use this after the OAuthProvider middleware to enforce scope requirements
 * on specific routes.
 * 
 * @example
 * ```typescript
 * const oauth = new OAuthProvider(config);
 * app.use('*', oauth.middleware());
 * 
 * // Require 'admin' scope for this route
 * app.get('/api/admin', 
 *   requireOAuthScope('admin'), 
 *   (c) => c.json({ admin: true })
 * );
 * 
 * // Require multiple scopes
 * app.delete('/api/data/:id',
 *   requireOAuthScope('write delete'),
 *   (c) => c.json({ deleted: c.req.param('id') })
 * );
 * ```
 */
export function requireOAuthScope(requiredScope: string) {
  return async (c: Context, next: () => Promise<void>) => {
    const oauth = c.get('oauth');
    
    if (!oauth) {
      return c.json({ 
        error: 'unauthorized',
        error_description: 'OAuth authentication required'
      }, 401);
    }
    
    if (!oauth.checkScope(requiredScope)) {
      return c.json({ 
        error: 'insufficient_scope',
        error_description: `Required scope: ${requiredScope}`
      }, 403);
    }
    
    await next();
  };
}

