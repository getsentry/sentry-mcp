/**
 * OAuth 2.0 Dynamic Client Registration Handler
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc7591 - OAuth 2.0 Dynamic Client Registration
 * @see https://datatracker.ietf.org/doc/html/rfc7591#section-2 - Client Registration Request
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics#section-2.1 - Registration Security
 */

import type { Context } from 'hono';
import type { Storage, Client, OAuth21Config } from '../types';
import { generateSecureToken } from '../lib/utils';
import { generateClientSecret, hashClientSecret } from '../lib/crypto';
import { ClientRegistrationSchema, sanitizeClientMetadata, validateRedirectUri } from '../lib/validation';

export class RegisterHandler {
  constructor(
    private storage: Storage,
    private config: OAuth21Config
  ) {}

  /**
   * Handle POST /register - Register a new OAuth client
   */
  async handle(c: Context) {
    try {
      const body = await c.req.json();
      
      // Validate and sanitize input
      const validatedData = ClientRegistrationSchema.parse(body);
      const metadata = sanitizeClientMetadata(validatedData);
      
      // Validate redirect URIs
      for (const uri of metadata.redirect_uris) {
        const validatedUri = validateRedirectUri(uri);
        if (!validatedUri) {
          return c.json({ 
            error: 'invalid_redirect_uri',
            error_description: `Invalid redirect URI: ${uri}`
          }, 400);
        }
      }
      
      // Generate client credentials
      const clientId = generateSecureToken();
      const clientSecret = generateClientSecret();
      const hashedSecret = await hashClientSecret(clientSecret);
      
      // Determine client type
      const isConfidential = metadata.token_endpoint_auth_method !== 'none';
      
      // Store client
      const client: Client = {
        id: clientId,
        secret: isConfidential ? hashedSecret : undefined,
        name: metadata.client_name,
        redirectUris: metadata.redirect_uris,
      };
      
      await this.storage.put(
        `client:${clientId}`,
        JSON.stringify(client)
      );
      
      // Log registration for audit
      console.log('[OAuth] Client registered:', {
        clientId,
        name: metadata.client_name,
        redirectUris: metadata.redirect_uris.length,
        authMethod: metadata.token_endpoint_auth_method,
        timestamp: new Date().toISOString()
      });
      
      // Return client information
      const response: any = {
        client_id: clientId,
        client_name: metadata.client_name,
        redirect_uris: metadata.redirect_uris,
        token_endpoint_auth_method: metadata.token_endpoint_auth_method || 'client_secret_post',
        grant_types: metadata.grant_types || ['authorization_code', 'refresh_token'],
        response_types: metadata.response_types || ['code'],
        scope: metadata.scope,
        client_id_issued_at: Math.floor(Date.now() / 1000),
      };
      
      // Only include secret for confidential clients
      if (isConfidential) {
        response.client_secret = clientSecret;
        response.client_secret_expires_at = 0; // Never expires
      }
      
      return c.json(response, 201);
    } catch (error) {
      if (error instanceof Error) {
        return c.json({ 
          error: 'invalid_client_metadata',
          error_description: error.message 
        }, 400);
      }
      throw error;
    }
  }
}