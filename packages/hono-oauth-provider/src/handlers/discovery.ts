/**
 * OAuth 2.0 Authorization Server Metadata Discovery Handler
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc8414 - OAuth 2.0 Authorization Server Metadata
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10#section-4.3 - OAuth 2.1 Metadata
 */

import type { Context } from 'hono';
import type { OAuth21Config } from '../types';

export class DiscoveryHandler {
  constructor(private config: OAuth21Config) {}

  /**
   * Handle GET /.well-known/oauth-authorization-server
   */
  async handle(c: Context) {
    return c.json({
      issuer: this.config.issuer,
      authorization_endpoint: `${this.config.issuer}/authorize`,
      token_endpoint: `${this.config.issuer}/token`,
      revocation_endpoint: `${this.config.issuer}/revoke`,
      introspection_endpoint: `${this.config.issuer}/introspect`,
      registration_endpoint: `${this.config.issuer}/register`,
      scopes_supported: this.config.scopesSupported,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256', 'plain'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
      // OAuth 2.1 additional metadata
      response_modes_supported: ['query', 'fragment'],
      authorization_response_iss_parameter_supported: true,
      require_request_uri_registration: false,
      claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat'],
      request_parameter_supported: false,
      request_uri_parameter_supported: false,
      require_pushed_authorization_requests: false,
      token_endpoint_auth_signing_alg_values_supported: ['RS256'],
      ui_locales_supported: ['en'],
      service_documentation: undefined,
      op_policy_uri: undefined,
      op_tos_uri: undefined,
    });
  }
}