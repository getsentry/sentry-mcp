/**
 * Service Provider for Dependency Injection
 * 
 * This provider allows injection of different service implementations
 * for production and testing environments.
 */

import type { Context } from "hono";
import type { KVNamespace } from "@cloudflare/workers-types";
import type { OAuthService } from "./oauth-interface";
import { CloudflareOAuthService } from "./oauth";
import { CloudflareStorage } from "./storage-interface";
import type { Env } from "../types";

export interface ServiceProvider {
  oauth: OAuthService;
}

/**
 * Service factory that creates the appropriate services based on environment
 */
export class ServiceFactory {
  /**
   * Creates production services using Cloudflare bindings
   */
  static createProduction(env: Env): ServiceProvider {
    return {
      oauth: new CloudflareOAuthService(new CloudflareStorage(env.OAUTH_KV)),
    };
  }
  
  /**
   * Creates test services using in-memory implementations
   */
  static createTest(mockOAuth?: OAuthService): ServiceProvider {
    if (mockOAuth) {
      return { oauth: mockOAuth };
    }
    
    // Default in-memory implementation for testing
    const { InMemoryOAuthService } = require("./oauth-memory");
    return {
      oauth: new InMemoryOAuthService(),
    };
  }
  
  /**
   * Gets services from Hono context or creates them
   */
  static fromContext<T extends { Bindings: Env }>(c: Context<T>): ServiceProvider {
    // Check if services are already in context (for testing)
    const existingServices = (c as any).var?.services;
    if (existingServices) {
      return existingServices;
    }
    
    // Create production services from environment
    return ServiceFactory.createProduction(c.env);
  }
}

/**
 * Middleware to inject services into Hono context
 */
export function injectServices(services?: ServiceProvider) {
  return async (c: Context<any>, next: () => Promise<void>) => {
    // Use provided services or create from environment
    const serviceProvider = services || ServiceFactory.fromContext(c);
    
    // Store in context variables
    c.set("services", serviceProvider);
    
    await next();
  };
}