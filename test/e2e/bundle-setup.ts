/**
 * Shared npm bundle build helper for e2e tests.
 *
 * Serializes bundle builds across parallel test files so `bundle.test.ts` and
 * `library.test.ts` never run `pnpm run bundle` concurrently or delete `dist/`
 * while another file's build is in flight.
 */

import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

function noop(): void {
  // Intentionally empty — absorbs async spawn errors
}

const ROOT_DIR = join(import.meta.dirname, "../..");

/** Bundled library entrypoint used by library-mode e2e tests. */
export const BUNDLE_INDEX_PATH = join(ROOT_DIR, "dist/index.cjs");

/** CLI wrapper entrypoint used by npm bundle e2e tests. */
export const BUNDLE_BIN_PATH = join(ROOT_DIR, "dist/bin.cjs");

/** Bundled library type declarations. */
export const BUNDLE_TYPES_PATH = join(ROOT_DIR, "dist/index.d.cts");

let buildPromise: Promise<void> | null = null;

/**
 * Ensure the npm bundle exists under `dist/`, building it once if needed.
 *
 * @param options.clean - When true, delete `dist/` before building. Only the
 *   first concurrent caller's preference applies while a build is in flight.
 */
export function ensureBundleBuilt(options?: {
  clean?: boolean;
}): Promise<void> {
  if (!options?.clean && existsSync(BUNDLE_INDEX_PATH)) {
    return Promise.resolve();
  }

  buildPromise ??= runBundleBuild(Boolean(options?.clean));
  return buildPromise;
}

async function runBundleBuild(clean: boolean): Promise<void> {
  const distDir = join(ROOT_DIR, "dist");
  if (clean && existsSync(distDir)) {
    rmSync(distDir, { recursive: true, force: true });
  }

  const exitCode = await new Promise<number>((resolve) => {
    let buildStderr = "";
    const proc = spawn("pnpm", ["run", "bundle"], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        SENTRY_CLIENT_ID: process.env.SENTRY_CLIENT_ID || "test-client-id",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    proc.on("error", noop);
    proc.stderr.on("data", (d: Buffer) => {
      buildStderr += d;
    });
    proc.on("close", (code) => {
      if ((code ?? 1) !== 0) {
        console.error(`Bundle failed with exit code ${code}: ${buildStderr}`);
      }
      resolve(code ?? 1);
    });
  });

  if (exitCode !== 0 || !existsSync(BUNDLE_INDEX_PATH)) {
    buildPromise = null;
    throw new Error("Bundle not built — cannot run library/bundle tests");
  }
}
