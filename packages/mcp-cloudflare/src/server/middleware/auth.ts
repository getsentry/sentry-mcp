import type { MiddlewareHandler } from "hono";
import type { Env, WorkerProps } from "../types";
import { createOAuthService } from "../services/oauth";

/**
 * OAuth authentication middleware for Hono
 * Validates the Bearer token and extracts user properties
 */
export const requireAuth: MiddlewareHandler<{
  Bindings: Env;
  Variables: {
    user: WorkerProps;
    oauthService: ReturnType<typeof createOAuthService>;
  };
}> = async (c, next) => {
  const authorization = c.req.header("Authorization");
  
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return c.json(
      {
        error: "unauthorized",
        error_description: "Missing or invalid authorization header",
      },
      401
    );
  }
  
  const token = authorization.substring(7); // Remove "Bearer " prefix
  
  // Create OAuth service using KV from environment
  const oauthService = createOAuthService(c.env.OAUTH_KV);
  
  try {
    // Validate token and get user properties
    const userProps = await oauthService.validateToken(token);
    
    if (!userProps) {
      return c.json(
        {
          error: "unauthorized",
          error_description: "Invalid or expired token",
        },
        401
      );
    }
    
    // Validate required properties
    if (!userProps.id || !userProps.accessToken) {
      console.error("Invalid token props:", { hasId: !!userProps.id, hasToken: !!userProps.accessToken });
      return c.json(
        {
          error: "unauthorized",
          error_description: "Token missing required properties",
        },
        401
      );
    }
    
    // Set user and service in context for downstream handlers
    c.set("user", userProps);
    c.set("oauthService", oauthService);
    
    await next();
  } catch (error) {
    console.error("Token validation error:", error);
    return c.json(
      {
        error: "unauthorized",
        error_description: "Token validation failed",
      },
      401
    );
  }
};