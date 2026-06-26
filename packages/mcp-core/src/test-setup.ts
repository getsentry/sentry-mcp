import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServer } from "@sentry/mcp-server-mocks";
import type { ServerContext } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../../");

// Load environment variables from multiple possible locations
// IMPORTANT: Do NOT use override:true as it would overwrite shell/CI environment variables

// Load local package .env first (for package-specific overrides)
config({ path: path.resolve(__dirname, "../.env") });

// Load root .env second (for shared defaults - won't override local or shell vars)
config({ path: path.join(rootDir, ".env") });

startMockServer({ ignoreOpenAI: true });

/**
 * Creates a ServerContext for testing with default values and optional overrides.
 *
 * @param overrides - Partial ServerContext to override default values
 * @returns Complete ServerContext for testing
 *
 * @example
 * ```typescript
 * // Default context
 * const context = getServerContext();
 *
 * // With constraint overrides
 * const context = getServerContext({
 *   constraints: { organizationSlug: "my-org" }
 * });
 *
 * // With user override
 * const context = getServerContext({
 *   userId: "custom-user-id"
 * });
 * ```
 */
export function getServerContext(
  overrides: Partial<ServerContext> = {},
): ServerContext {
  const defaultContext: ServerContext = {
    accessToken: "access-token",
    userId: "1",
    constraints: {
      organizationSlug: null,
      projectSlug: null,
    },
  };

  return {
    ...defaultContext,
    ...overrides,
    // Ensure constraints are properly merged
    constraints: {
      ...defaultContext.constraints,
      ...overrides.constraints,
    },
  };
}
