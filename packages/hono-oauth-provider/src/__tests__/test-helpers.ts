/**
 * Test Helpers for OAuth Provider
 * 
 * These helpers wrap the OAuth provider middleware to work with existing tests
 */

import { Hono } from 'hono';
import { OAuthProvider as OAuthProviderMiddleware } from '../oauth-provider';
import type { OAuth21Config } from '../types';

/**
 * Test wrapper for OAuthProvider that provides a class-based API
 * This is only used in tests to maintain the existing test structure
 */
export class OAuthProviderTestWrapper {
  private app: Hono;
  
  constructor(config: OAuth21Config) {
    // Create our own Hono app
    this.app = new Hono();
    // Apply the OAuth middleware to it
    const middleware = OAuthProviderMiddleware(config);
    this.app.use('*', middleware);
  }
  
  getApp(): Hono {
    return this.app;
  }
}