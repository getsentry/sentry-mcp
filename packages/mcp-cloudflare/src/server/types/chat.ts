/**
 * Type definitions for Chat API
 */

// Error response types
export type ErrorName =
  // 400-level errors (client errors)
  | "MISSING_AUTH_TOKEN"
  | "INVALID_MESSAGES_FORMAT"
  // 401-level errors (authentication)
  | "AUTH_EXPIRED"
  | "AI_AUTH_FAILED"
  | "SENTRY_AUTH_INVALID"
  // 403-level errors (authorization)
  | "INSUFFICIENT_PERMISSIONS"
  // 429-level errors (rate limiting)
  | "RATE_LIMIT_EXCEEDED"
  | "AI_RATE_LIMIT"
  // 500-level errors (server errors)
  | "AI_SERVICE_UNAVAILABLE"
  | "RATE_LIMITER_ERROR"
  | "MCP_CONNECTION_FAILED"
  | "INTERNAL_ERROR";

export interface ErrorResponse {
  error: string;
  name?: ErrorName;
  eventId?: string;
}

// Request types
export interface ChatRequest {
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
}

// MCP types
export interface MCPTools {
  [toolName: string]: {
    description?: string;
    parameters?: unknown;
  };
}

// Rate limiter types
export interface RateLimitResult {
  success: boolean;
}
