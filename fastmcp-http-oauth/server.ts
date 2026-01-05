/**
 * Sentry MCP Server with FastMCP HTTP Streamable Transport + OAuth 2.1
 *
 * A standalone MCP server that can run on-premises with:
 * - HTTP Streamable transport (MCP spec 2025-03-26)
 * - OAuth 2.1 with PKCE via OAuth Proxy
 * - Redis/Valkey token storage for stateless, distributed deployments
 *
 * This server provides an HTTP-based alternative to the stdio transport,
 * suitable for web-based MCP clients and distributed deployments.
 */

import { FastMCP } from "fastmcp";
import {
  OAuthProxy,
  EncryptedTokenStorage,
  type TokenStorage,
} from "fastmcp/auth";
import { z } from "zod";
import { Redis } from "ioredis";
import { RedisTokenStorage } from "./redis-token-storage.js";

// Import all tools from mcp-core
// Path resolves from source location for TypeScript, Docker copies to runtime location
// For standalone deployment via npm: change to import from "@sentry/mcp-core/tools"
import tools from "../packages/mcp-core/dist/tools/index.js";
import type {
  ServerContext,
  Constraints,
} from "../packages/mcp-core/dist/types.js";
import { setOpenAIBaseUrl } from "../packages/mcp-core/dist/internal/agents/openai-provider.js";

// ============================================================================
// Logging
// ============================================================================

/**
 * Custom logger that filters out noisy FastMCP warnings in stateless mode.
 * These warnings are expected when clients don't respond to capability queries.
 */
const createLogger = () => {
  const FILTERED_WARNINGS = [
    "could not infer client capabilities",
    "received error listing roots",
  ];

  return {
    debug: (...args: unknown[]) => {
      // Suppress debug logs in production (they're very noisy)
      if (process.env.LOG_LEVEL === "debug") {
        console.debug(...args);
      }
    },
    info: (...args: unknown[]) => {
      console.info(...args);
    },
    log: (...args: unknown[]) => {
      console.log(...args);
    },
    warn: (...args: unknown[]) => {
      // Filter out known noisy warnings that are expected in stateless HTTP mode
      const message = args[0]?.toString() || "";
      if (FILTERED_WARNINGS.some((w) => message.includes(w))) {
        // Only log if debug level is enabled
        if (process.env.LOG_LEVEL === "debug") {
          console.debug("[filtered]", ...args);
        }
        return;
      }
      console.warn(...args);
    },
    error: (...args: unknown[]) => {
      // Filter out known errors that are expected in stateless mode
      const message = args[0]?.toString() || "";
      if (FILTERED_WARNINGS.some((w) => message.includes(w))) {
        if (process.env.LOG_LEVEL === "debug") {
          console.debug("[filtered]", ...args);
        }
        return;
      }
      console.error(...args);
    },
  };
};

/**
 * Log a tool call with user and timing information
 */
function logToolCall(
  toolName: string,
  userId: string | undefined,
  clientId: string,
  durationMs: number,
  success: boolean,
  error?: string,
) {
  const timestamp = new Date().toISOString();
  const status = success ? "✓" : "✗";
  const userInfo = userId ? `user=${userId}` : "user=unknown";
  const duration = `${durationMs}ms`;

  if (success) {
    console.log(
      `[${timestamp}] ${status} TOOL_CALL tool=${toolName} ${userInfo} client=${clientId} duration=${duration}`,
    );
  } else {
    console.error(
      `[${timestamp}] ${status} TOOL_CALL tool=${toolName} ${userInfo} client=${clientId} duration=${duration} error="${error}"`,
    );
  }
}

// ============================================================================
// Configuration
// ============================================================================

// Default Sentry OAuth scopes required for MCP server
const DEFAULT_SENTRY_SCOPES = [
  "org:read",
  "project:read",
  "project:write",
  "team:read",
  "team:write",
  "event:write",
];

interface ServerConfig {
  // Server
  port: number;
  host: string; // Bind address (0.0.0.0 for all interfaces)
  baseUrl: string;

  // Sentry (self-hosted)
  sentryHost: string;
  sentryClientId: string;
  sentryClientSecret: string;
  sentryScopes: string[]; // OAuth scopes to request

  // Redis/Valkey
  redisUrl: string;
  redisTls: boolean; // Enable TLS for Redis/Valkey connection
  redisTlsRejectUnauthorized: boolean; // Verify TLS certificates

  // Security
  encryptionKey: string; // 32+ char secret for token encryption
  jwtSigningKey: string; // Secret for signing JWT tokens

  // Optional: OpenAI API for AI-powered tools
  openaiApiKey?: string;
  openaiBaseUrl?: string;

  // Optional: MCP URL for docs tools
  mcpUrl?: string;

  // OAuth redirect URI patterns (comma-separated, supports wildcards)
  // Default: "*" (allows any redirect URI - restrict in production!)
  allowedRedirectUriPatterns: string[];
}

function loadConfig(): ServerConfig {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  };

  const parseBoolean = (
    value: string | undefined,
    defaultValue: boolean,
  ): boolean => {
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === "true" || value === "1";
  };

  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

  // Auto-detect TLS requirement:
  // - rediss:// URL scheme means TLS
  // - AWS ElastiCache Serverless always requires TLS
  const isRedissScheme = redisUrl.startsWith("rediss://");
  const isAwsElastiCache = redisUrl.includes(".cache.amazonaws.com");
  const autoDetectTls = isRedissScheme || isAwsElastiCache;

  const redisTls = parseBoolean(process.env.REDIS_TLS, autoDetectTls);

  if (autoDetectTls && !redisTls) {
    console.warn(
      "⚠️  Warning: AWS ElastiCache detected but REDIS_TLS=false. TLS will be auto-enabled.",
    );
  }

  // Parse scopes from environment or use defaults
  const sentryScopes = process.env.SENTRY_SCOPES
    ? process.env.SENTRY_SCOPES.split(",").map((s) => s.trim())
    : DEFAULT_SENTRY_SCOPES;

  return {
    port: Number.parseInt(process.env.PORT ?? "3000", 10),
    host: process.env.HOST ?? "0.0.0.0", // Default to all interfaces for Docker
    baseUrl: required("BASE_URL"), // e.g., https://mcp.example.com
    sentryHost: required("SENTRY_HOST"), // e.g., sentry.example.com
    sentryClientId: required("SENTRY_CLIENT_ID"),
    sentryClientSecret: required("SENTRY_CLIENT_SECRET"),
    sentryScopes,
    redisUrl,
    redisTls: redisTls || autoDetectTls, // Force TLS for AWS ElastiCache
    redisTlsRejectUnauthorized: parseBoolean(
      process.env.REDIS_TLS_REJECT_UNAUTHORIZED,
      true,
    ),
    encryptionKey: required("ENCRYPTION_KEY"),
    jwtSigningKey: required("JWT_SIGNING_KEY"),
    // Optional AI features
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    mcpUrl: process.env.MCP_URL,
    // OAuth redirect URI patterns (security: restrict in production)
    allowedRedirectUriPatterns: process.env.ALLOWED_REDIRECT_URI_PATTERNS
      ? process.env.ALLOWED_REDIRECT_URI_PATTERNS.split(",").map((p) =>
          p.trim(),
        )
      : ["*"], // Default allows all - should be restricted in production
  };
}

// ============================================================================
// Redis Client Setup
// ============================================================================

interface RedisConnectionOptions {
  url: string;
  tls: boolean;
  tlsRejectUnauthorized: boolean;
}

async function createRedisClient(
  options: RedisConnectionOptions,
): Promise<RedisTokenStorage> {
  console.log(
    `   Connecting to Redis: ${options.url.replace(/\/\/.*@/, "//***@")}${options.tls ? " (TLS)" : ""}...`,
  );

  const client = new Redis(options.url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectTimeout: 10000, // 10 second connection timeout
    // TLS configuration for encrypted Valkey/Redis connections
    // AWS ElastiCache Serverless requires TLS even with redis:// URL
    ...(options.tls && {
      tls: {
        rejectUnauthorized: options.tlsRejectUnauthorized,
        // For custom CA certificates, you can add:
        // ca: fs.readFileSync('/path/to/ca.crt'),
      },
    }),
  });

  // Wait for connection with timeout
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.disconnect();
      reject(new Error("Redis connection timeout after 15 seconds"));
    }, 15000);

    client.on("ready", () => {
      clearTimeout(timeout);
      resolve();
    });

    client.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(new Error(`Redis connection error: ${err.message}`));
    });
  });

  console.log("   ✓ Connected to Redis/Valkey");

  return new RedisTokenStorage({
    client: client as unknown as import("./redis-token-storage.js").RedisClient,
    keyPrefix: "sentry-mcp:oauth:",
  });
}

// ============================================================================
// Sentry OAuth Provider
// ============================================================================

function createSentryOAuthProxy(
  config: ServerConfig,
  tokenStorage: TokenStorage,
): OAuthProxy {
  // Wrap with encryption for secure token storage
  const encryptedStorage = new EncryptedTokenStorage(
    tokenStorage,
    config.encryptionKey,
  );

  console.log(`   OAuth scopes: ${config.sentryScopes.join(", ")}`);

  return new OAuthProxy({
    // Base URL of this MCP server
    baseUrl: config.baseUrl,

    // Upstream Sentry OAuth endpoints
    upstreamClientId: config.sentryClientId,
    upstreamClientSecret: config.sentryClientSecret,
    upstreamAuthorizationEndpoint: `https://${config.sentryHost}/oauth/authorize/`,
    upstreamTokenEndpoint: `https://${config.sentryHost}/oauth/token/`,

    // Scopes to request from Sentry (configurable via SENTRY_SCOPES env var)
    scopes: config.sentryScopes,

    // Token storage
    tokenStorage: encryptedStorage,

    // JWT settings for token swap pattern
    enableTokenSwap: true,
    jwtSigningKey: config.jwtSigningKey,

    // Security settings
    consentRequired: true, // Show consent screen
    authorizationCodeTtl: 300, // 5 minutes
    transactionTtl: 600, // 10 minutes

    // Allowed redirect URI patterns for OAuth clients
    // Configure via ALLOWED_REDIRECT_URI_PATTERNS env var in production
    allowedRedirectUriPatterns: config.allowedRedirectUriPatterns,
  });
}

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Request object passed to authenticate callback
 */
interface AuthenticateRequest {
  headers: {
    authorization?: string;
  };
}

/**
 * Context passed to tool execute callback
 */
interface ToolExecuteContext {
  session: SentrySession | undefined;
}

/**
 * Session data returned from authenticate and passed to tool handlers
 */
interface SentrySession {
  /** Index signature for FastMCPSessionAuth compatibility */
  [key: string]: unknown;
  /** Sentry access token (from upstream) */
  accessToken: string;
  /** User ID from JWT claims */
  userId?: string;
  /** Client ID */
  clientId: string;
  /** Granted scopes */
  scopes: string[];
  /** Sentry host */
  sentryHost: string;
}

// ============================================================================
// Tool Registration Helper
// ============================================================================

/**
 * Convert mcp-core tool inputSchema to a Zod object schema for FastMCP
 */
function createZodObjectSchema(
  inputSchema: Record<string, z.ZodType>,
): z.ZodObject<Record<string, z.ZodType>> {
  return z.object(inputSchema);
}

/**
 * Create a ServerContext from FastMCP session for mcp-core tool handlers
 */
function createServerContext(
  session: SentrySession,
  config: ServerConfig,
): ServerContext {
  const constraints: Constraints = {
    organizationSlug: null,
    projectSlug: null,
    regionUrl: null,
  };

  return {
    sentryHost: session.sentryHost,
    accessToken: session.accessToken,
    userId: session.userId || null,
    clientId: session.clientId,
    constraints,
    // Optional: OpenAI settings for AI-powered tools
    openaiBaseUrl: config.openaiBaseUrl,
    // Optional: MCP URL for docs tools
    mcpUrl: config.mcpUrl,
  };
}

// ============================================================================
// Tools that require OpenAI API
// ============================================================================

const AI_POWERED_TOOLS = new Set([
  "search_events",
  "search_issues",
  "search_issue_events",
  "use_sentry",
]);

// ============================================================================
// MCP Server Setup
// ============================================================================

async function createServer(config: ServerConfig) {
  // Initialize Redis storage with TLS support
  const redisStorage = await createRedisClient({
    url: config.redisUrl,
    tls: config.redisTls,
    tlsRejectUnauthorized: config.redisTlsRejectUnauthorized,
  });

  // Create Sentry OAuth proxy
  const oauthProxy = createSentryOAuthProxy(config, redisStorage);

  // Create FastMCP server with custom logger
  const logger = createLogger();
  const server = new FastMCP<SentrySession>({
    name: "sentry-mcp",
    version: "1.0.0",
    logger, // Custom logger to filter noisy warnings
    instructions:
      "Sentry MCP server for error tracking and performance monitoring. " +
      "Use the available tools to search issues, view error details, and manage projects.",

    // OAuth configuration
    oauth: {
      enabled: true,
      // Discovery metadata
      authorizationServer: oauthProxy.getAuthorizationServerMetadata(),
      protectedResource: {
        resource: config.baseUrl,
        authorizationServers: [config.baseUrl],
        scopesSupported: config.sentryScopes,
      },
      // OAuth proxy handles the flow
      proxy: oauthProxy,
    },

    // Authentication - extract session from JWT
    authenticate: async (request: AuthenticateRequest) => {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        throw new Error("Missing or invalid Authorization header");
      }

      const token = authHeader.slice(7);

      // Load upstream tokens from the FastMCP JWT
      const upstreamTokens = await oauthProxy.loadUpstreamTokens(token);
      if (!upstreamTokens) {
        throw new Error("Invalid or expired token");
      }

      // Parse JWT claims for user info (basic decode, already verified by loadUpstreamTokens)
      let payload: { sub?: string; client_id?: string };
      try {
        const parts = token.split(".");
        if (parts.length < 2 || !parts[1]) {
          throw new Error("Token missing payload segment");
        }
        payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      } catch (err) {
        throw new Error(
          `Failed to parse token payload: ${err instanceof Error ? err.message : "invalid format"}`,
        );
      }

      // Normalize scopes to array (OAuth 2.0/2.1 may return space-separated string)
      const rawScope = upstreamTokens.scope as string | string[] | undefined;
      const scopes = Array.isArray(rawScope)
        ? rawScope
        : typeof rawScope === "string"
          ? rawScope.split(" ").filter(Boolean)
          : [];

      return {
        accessToken: upstreamTokens.accessToken,
        userId: payload.sub,
        clientId: payload.client_id ?? "unknown",
        scopes,
        sentryHost: config.sentryHost,
      };
    },

    // Health check endpoint
    health: {
      enabled: true,
      path: "/health",
      message: "ok",
    },
  });

  // ============================================================================
  // Register All Sentry Tools from mcp-core
  // ============================================================================

  let registeredCount = 0;
  let skippedCount = 0;

  // Type for individual tool config
  type ToolConfigAny = {
    name: string;
    description: string;
    inputSchema: Record<string, z.ZodType>;
    annotations: {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
      openWorldHint?: boolean;
    };
    handler: (
      params: unknown,
      context: ServerContext,
    ) => Promise<string | unknown[]>;
  };

  for (const toolName of Object.keys(tools)) {
    const toolConfig = tools[
      toolName as keyof typeof tools
    ] as unknown as ToolConfigAny;

    // Skip AI-powered tools if OpenAI API key is not configured
    if (AI_POWERED_TOOLS.has(toolName) && !config.openaiApiKey) {
      console.log(`   ⚠️  Skipping ${toolName} (requires OPENAI_API_KEY)`);
      skippedCount++;
      continue;
    }

    try {
      server.addTool({
        name: toolConfig.name,
        description: toolConfig.description,
        parameters: createZodObjectSchema(toolConfig.inputSchema),
        annotations: toolConfig.annotations,
        execute: async (
          args: Record<string, unknown>,
          context: ToolExecuteContext,
        ) => {
          const session = context.session;
          if (!session) {
            throw new Error("Not authenticated");
          }

          const startTime = Date.now();

          try {
            // Create ServerContext from FastMCP session
            const serverContext = createServerContext(session, config);

            // Call the mcp-core tool handler
            const result = await toolConfig.handler(args, serverContext);

            // Log successful tool call
            logToolCall(
              toolConfig.name,
              session.userId,
              session.clientId,
              Date.now() - startTime,
              true,
            );

            // Handle different result types
            if (typeof result === "string") {
              return result;
            }

            // If result is an array of content objects, format as JSON
            return JSON.stringify(result, null, 2);
          } catch (error) {
            // Log failed tool call
            logToolCall(
              toolConfig.name,
              session.userId,
              session.clientId,
              Date.now() - startTime,
              false,
              error instanceof Error ? error.message : String(error),
            );
            throw error;
          }
        },
      });

      registeredCount++;
    } catch (err) {
      console.error(`   ❌ Failed to register tool ${String(toolName)}:`, err);
      skippedCount++;
    }
  }

  console.log(
    `   ✓ Registered ${registeredCount} tools (${skippedCount} skipped)`,
  );

  return { server, redisStorage };
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  console.log("🚀 Starting Sentry MCP Server (FastMCP + HTTP + OAuth 2.1)");
  console.log(`   Node version: ${process.version}`);
  console.log(`   PID: ${process.pid}`);

  let config: ServerConfig;
  try {
    config = loadConfig();
  } catch (err) {
    console.error("❌ Configuration error:", err);
    process.exit(1);
  }

  console.log(`   Base URL: ${config.baseUrl}`);
  console.log(`   Bind: ${config.host}:${config.port}`);
  console.log(`   Sentry Host: ${config.sentryHost}`);
  console.log(`   Redis: ${config.redisUrl}${config.redisTls ? " (TLS)" : ""}`);
  console.log(
    `   OpenAI API: ${config.openaiApiKey ? "✓ configured" : "⚠️  not configured (AI tools disabled)"}`,
  );
  if (config.openaiBaseUrl) {
    console.log(`   OpenAI Base URL: ${config.openaiBaseUrl}`);
  }

  // Configure OpenAI base URL for embedded agents (must be set explicitly, not via env var)
  if (config.openaiBaseUrl) {
    setOpenAIBaseUrl(config.openaiBaseUrl);
  }

  let server: Awaited<ReturnType<typeof createServer>>["server"];
  let redisStorage: Awaited<ReturnType<typeof createServer>>["redisStorage"];

  try {
    console.log("   Initializing server...");
    const result = await createServer(config);
    server = result.server;
    redisStorage = result.redisStorage;
    console.log("   ✓ Server initialized");
  } catch (err) {
    console.error("❌ Failed to initialize server:", err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n🛑 Shutting down...");
    await server.stop();
    await redisStorage.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start HTTP Streamable server
  console.log(`   Starting HTTP server on ${config.host}:${config.port}...`);

  try {
    await server.start({
      transportType: "httpStream",
      httpStream: {
        port: config.port,
        host: config.host || "0.0.0.0", // Bind to all interfaces (0.0.0.0) for Docker
        endpoint: "/mcp",
        stateless: true, // Required for distributed/load-balanced deployments
      },
    });
  } catch (err) {
    console.error("Failed to start HTTP server:", err);
    throw err;
  }

  console.log(`\n✅ Server running at ${config.baseUrl}`);
  console.log(`   MCP endpoint: ${config.baseUrl}/mcp`);
  console.log(`   Health check: ${config.baseUrl}/health`);
  console.log(
    `   OAuth discovery: ${config.baseUrl}/.well-known/oauth-authorization-server`,
  );
  console.log(`\n📖 Connect your MCP client using OAuth 2.1 flow`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
