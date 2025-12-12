/**
 * Global setup for vitest-pool-workers integration tests.
 *
 * This script pre-builds the worker using wrangler before tests run.
 * The pre-built worker handles all module resolution including:
 * - The MCP SDK's ajv dependency (replaced with cfworker validator in production build)
 * - @sentry/node (replaced with @sentry/cloudflare)
 *
 * See: https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/#auxiliary-workers
 */
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(__dirname, "..");

export default async function globalSetup() {
  console.log("[global-setup] Building worker for integration tests...");

  // Clean previous build
  const distDir = resolve(packageDir, "dist-test");
  rmSync(distDir, { recursive: true, force: true });

  // Build with wrangler (this applies all production transforms)
  execSync("pnpm exec wrangler deploy --dry-run --outdir dist-test", {
    cwd: packageDir,
    stdio: "inherit",
  });

  console.log("[global-setup] Worker built successfully");
}
