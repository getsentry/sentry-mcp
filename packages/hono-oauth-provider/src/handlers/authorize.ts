/**
 * OAuth 2.1 Authorization Endpoint Handler
 * 
 * Handles authorization requests and user consent flow.
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-3.1 - Authorization Endpoint
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-4.1 - OAuth 2.1 Authorization Request
 * @see https://datatracker.ietf.org/doc/html/rfc7636#section-4.3 - PKCE Code Challenge
 */

import type { Context } from 'hono';
import { z } from 'zod';
import type { Storage, Client, Grant, OAuth21Config } from '../types';
import { escapeHtml, generateSecureToken, generateCSRFToken } from '../lib/utils';
import { ConsentManager } from '../core/consent';
import { encryptContextForStorage } from '../lib/crypto-context';

// Constants
const AUTHORIZATION_CODE_EXPIRY_MS = 600000; // 10 minutes (OAuth 2.1 spec maximum)
const CSRF_TOKEN_EXPIRY_MS = 600000; // 10 minutes

// Request schema
const AuthorizeRequestSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string(),
  redirect_uri: z.string().url(),
  scope: z.string().optional(),
  state: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.enum(['S256', 'plain']).optional(),
});

export class AuthorizeHandler {
  constructor(
    private storage: Storage,
    private config: OAuth21Config,
    private consentManager: ConsentManager
  ) {}

  /**
   * Handle GET /authorize - Display consent form or auto-approve
   */
  async handleGet(c: Context) {
    try {
      const params = AuthorizeRequestSchema.parse(
        Object.fromEntries(new URL(c.req.url).searchParams)
      );

      // Get client
      // @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2.1
      // If client_id is invalid, MUST NOT redirect per spec
      const client = await this.getClient(params.client_id);
      if (!client) {
        return this.renderError(c, 
          'Invalid Client',
          'The client application is not registered.',
          'invalid_client',
          'Client authentication failed'
        );
      }

      // Validate redirect URI
      // @see https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2.1
      // If redirect_uri doesn't match, MUST NOT redirect per spec (prevents open redirector)
      if (!client.redirectUris.includes(params.redirect_uri)) {
        return this.renderError(c, 
          'Invalid Request',
          'The redirect URI provided does not match any registered URIs for this application.',
          'invalid_request',
          'The redirect_uri parameter does not match a pre-registered value.'
        );
      }

      // OAuth 2.1: Require PKCE for public clients
      // @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-7.1
      // This error CAN redirect since redirect_uri is valid
      const isPublicClient = !client.secret;
      if (isPublicClient && !params.code_challenge && this.config.strictMode) {
        const url = new URL(params.redirect_uri);
        url.searchParams.set('error', 'invalid_request');
        url.searchParams.set('error_description', 'PKCE is required for public clients');
        if (params.state) url.searchParams.set('state', params.state);
        return c.redirect(url.toString());
      }

      // Check for existing consent
      const userId = c.get('userId') || 'user-1'; // Get from auth middleware
      const existingConsent = await this.consentManager.checkConsent(
        userId,
        params.client_id,
        params.scope || 'read'
      );

      // If valid consent exists, skip consent screen
      if (existingConsent) {
        console.log('[OAuth] Using existing consent:', {
          userId,
          clientId: params.client_id,
          consentId: existingConsent.id,
          useCount: existingConsent.useCount
        });

        return this.issueAuthorizationCode(c, params, client, userId);
      }

      // Generate CSRF token for consent form
      const csrfToken = generateCSRFToken();
      
      await this.storage.put(
        `csrf:${csrfToken}`,
        JSON.stringify({
          clientId: params.client_id,
          redirectUri: params.redirect_uri,
          expiresAt: Date.now() + CSRF_TOKEN_EXPIRY_MS,
        }),
        { expirationTtl: CSRF_TOKEN_EXPIRY_MS / 1000 }
      );

      // Return consent form
      return this.renderConsentForm(c, client, params, csrfToken);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ 
          error: 'invalid_request',
          error_description: error.errors[0].message 
        }, 400);
      }
      throw error;
    }
  }

  /**
   * Handle POST /authorize - Process consent decision
   */
  async handlePost(c: Context) {
    const formData = await c.req.formData();
    const action = formData.get('action');
    const csrfToken = formData.get('csrf_token') as string;
    const redirectUri = formData.get('redirect_uri') as string;
    
    // Verify CSRF token
    if (!csrfToken) {
      return c.json({ error: 'invalid_request', error_description: 'Missing CSRF token' }, 400);
    }
    
    const csrfData = await this.storage.get<any>(
      `csrf:${csrfToken}`,
      { type: 'json' }
    );
    
    if (!csrfData || Date.now() > csrfData.expiresAt) {
      return c.json({ error: 'invalid_request', error_description: 'Invalid or expired CSRF token' }, 400);
    }
    
    // Delete CSRF token (single use)
    await this.storage.delete(`csrf:${csrfToken}`);
    
    // Validate redirect_uri matches CSRF data
    if (csrfData.redirectUri !== redirectUri) {
      return c.json({ error: 'invalid_request', error_description: 'Redirect URI mismatch' }, 400);
    }
    
    // Validate redirect_uri is not internal (SSRF protection)
    const url = new URL(redirectUri);
    if (this.isInternalUrl(url) && this.config.strictMode !== false) {
      return c.json({ error: 'invalid_request', error_description: 'Invalid redirect URI' }, 400);
    }
    
    if (action === 'deny') {
      const state = formData.get('state') as string;
      url.searchParams.set('error', 'access_denied');
      if (state) url.searchParams.set('state', state);
      return c.redirect(url.toString());
    }

    // Get user ID
    const userId = c.get('userId') || 'user-1';
    
    // Store consent
    const clientId = formData.get('client_id') as string;
    const scope = formData.get('scope') as string || 'read';
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    
    await this.consentManager.grantConsent(userId, clientId, scope, {
      ipAddress,
    });

    // Issue authorization code
    const params = {
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state: formData.get('state') as string,
      code_challenge: formData.get('code_challenge') as string,
      code_challenge_method: formData.get('code_challenge_method') as 'S256' | 'plain',
    };

    const client = await this.getClient(clientId);
    if (!client) {
      return c.json({ error: 'invalid_client' }, 400);
    }

    return this.issueAuthorizationCode(c, params, client, userId);
  }

  private async issueAuthorizationCode(
    c: Context, 
    params: any, 
    client: Client, 
    userId: string,
    context?: any  // Optional context for OAuth proxy functionality
  ) {
    const grantId = generateSecureToken();
    const code = generateSecureToken();
    
    const grant: Grant = {
      id: grantId,
      clientId: params.client_id,
      userId,
      scope: params.scope || 'read',
      code,
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge,
      codeChallengeMethod: params.code_challenge_method || 'S256',
      expiresAt: Date.now() + AUTHORIZATION_CODE_EXPIRY_MS,
      createdAt: Date.now(),
    };

    // Encrypt context if provided (for OAuth proxy functionality)
    if (context) {
      const encrypted = await encryptContextForStorage(context, code);
      grant.encryptedContext = encrypted.encryptedContext;
      grant.authCodeWrappedKey = encrypted.wrappedKey;
      grant.iv = encrypted.iv;
    }

    // Store grant
    await this.storage.put(
      `grant:${code}`,
      JSON.stringify(grant),
      { expirationTtl: 600 }
    );

    // Redirect with code
    const responseUrl = new URL(params.redirect_uri);
    responseUrl.searchParams.set('code', code);
    if (params.state) responseUrl.searchParams.set('state', params.state);
    
    return c.redirect(responseUrl.toString());
  }

  private renderConsentForm(c: Context, client: Client, params: any, csrfToken: string) {
    return c.html(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authorization Request</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
          }
          .consent-container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            padding: 32px;
            max-width: 400px;
            width: 100%;
          }
          h2 {
            margin: 0 0 24px;
            color: #333;
            font-size: 24px;
          }
          .client-info {
            background: #f8f9fa;
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 24px;
          }
          .client-name {
            font-weight: 600;
            color: #495057;
            margin-bottom: 8px;
          }
          .scope-list {
            margin: 16px 0;
          }
          .scope-item {
            padding: 8px 0;
            color: #666;
          }
          .consent-options {
            margin: 20px 0;
            padding: 16px;
            background: #f0f7ff;
            border-radius: 6px;
            border: 1px solid #d0e3ff;
          }
          .button-group {
            display: flex;
            gap: 12px;
            margin-top: 24px;
          }
          button {
            flex: 1;
            padding: 12px 24px;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
          }
          button[value="approve"] {
            background: #28a745;
            color: white;
          }
          button[value="approve"]:hover {
            background: #218838;
          }
          button[value="deny"] {
            background: #fff;
            color: #dc3545;
            border: 2px solid #dc3545;
          }
          button[value="deny"]:hover {
            background: #dc3545;
            color: white;
          }
          .security-notice {
            margin-top: 20px;
            padding: 12px;
            background: #fff3cd;
            border: 1px solid #ffeeba;
            border-radius: 4px;
            color: #856404;
            font-size: 13px;
          }
        </style>
      </head>
      <body>
        <div class="consent-container">
          <form method="POST" action="/authorize">
            <h2>Authorize ${escapeHtml(client.name)}</h2>
            <div class="client-info">
              <div class="client-name">${escapeHtml(client.name)}</div>
              <div style="color: #6c757d; font-size: 14px;">is requesting access to your account</div>
            </div>
            
            <div class="scope-list">
              <div style="font-weight: 600; margin-bottom: 8px;">This application will be able to:</div>
              ${(params.scope || 'read').split(' ').map((scope: string) => `
                <div class="scope-item">• ${escapeHtml(scope)} access</div>
              `).join('')}
            </div>

            <div class="consent-options">
              <div style="color: #495057; font-size: 14px;">
                ✓ Your authorization will be remembered for 90 days
              </div>
            </div>

            <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
            <input type="hidden" name="client_id" value="${escapeHtml(params.client_id)}">
            <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirect_uri)}">
            <input type="hidden" name="scope" value="${escapeHtml(params.scope || '')}">
            <input type="hidden" name="state" value="${escapeHtml(params.state || '')}">
            <input type="hidden" name="code_challenge" value="${escapeHtml(params.code_challenge || '')}">
            <input type="hidden" name="code_challenge_method" value="${escapeHtml(params.code_challenge_method || 'S256')}">
            
            <div class="button-group">
              <button type="submit" name="action" value="approve">Authorize</button>
              <button type="submit" name="action" value="deny">Cancel</button>
            </div>

            <div class="security-notice">
              🔒 Your authorization can be revoked at any time from your account settings.
            </div>
          </form>
        </div>
      </body>
      </html>
    `);
  }

  private renderError(c: Context, title: string, message: string, error: string, description: string) {
    return c.html(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>OAuth Error</title>
        <style>
          body { font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; }
          .error { background: #fee; padding: 20px; border-radius: 5px; }
          h1 { color: #c00; }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(message)}</p>
          <p><strong>Error:</strong> ${escapeHtml(error)}</p>
          <p><strong>Description:</strong> ${escapeHtml(description)}</p>
        </div>
      </body>
      </html>
    `, 400);
  }

  private isInternalUrl(url: URL): boolean {
    const hostname = url.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return this.config.strictMode !== false;
    }
    return hostname.startsWith('192.168.') || 
           hostname.startsWith('10.') ||
           hostname.endsWith('.local') || 
           hostname.endsWith('.internal');
  }

  private async getClient(clientId: string): Promise<Client | null> {
    return this.storage.get<Client>(`client:${clientId}`, { type: 'json' });
  }
}