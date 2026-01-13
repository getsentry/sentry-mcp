#!/usr/bin/env bun
/**
 * Build script for Sentry CLI
 *
 * Creates standalone executables for multiple platforms using Bun.build().
 * Inspired by OpenCode's build system.
 *
 * Usage:
 *   bun run script/build.ts           # Build for all platforms
 *   bun run script/build.ts --single  # Build for current platform only
 *   bun run script/build.ts --baseline # Include baseline (no AVX2) builds
 *
 * @see https://bun.sh/docs/bundler/executables
 */

import pkg from "../package.json";

const VERSION = pkg.version;

/**
 * Build-time constants injected into the binary
 *
 * SENTRY_CLIENT_ID: OAuth client ID for device flow authentication
 *   - Required for npm distribution
 *   - Set via SENTRY_CLIENT_ID environment variable at build time
 *   - Can be overridden at runtime for self-hosted Sentry
 */
const SENTRY_CLIENT_ID = process.env.SENTRY_CLIENT_ID ?? "";

/**
 * Build targets configuration
 */
type BuildTarget = {
  name: string;
  target: string;
  ext: string;
};

/**
 * Standard targets (modern CPUs with AVX2)
 */
const STANDARD_TARGETS: BuildTarget[] = [
  { name: "darwin-arm64", target: "bun-darwin-arm64", ext: "" },
  { name: "darwin-x64", target: "bun-darwin-x64", ext: "" },
  { name: "linux-x64", target: "bun-linux-x64", ext: "" },
  { name: "linux-arm64", target: "bun-linux-arm64", ext: "" },
  { name: "windows-x64", target: "bun-windows-x64", ext: ".exe" },
];

/**
 * Baseline targets (older CPUs without AVX2)
 */
const BASELINE_TARGETS: BuildTarget[] = [
  { name: "darwin-x64-baseline", target: "bun-darwin-x64-baseline", ext: "" },
  { name: "linux-x64-baseline", target: "bun-linux-x64-baseline", ext: "" },
  {
    name: "windows-x64-baseline",
    target: "bun-windows-x64-baseline",
    ext: ".exe",
  },
];

/**
 * Get current platform target
 */
function getCurrentTarget(): BuildTarget {
  const platform = process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "x64";

  if (platform === "darwin") {
    return {
      name: `darwin-${arch}`,
      target: `bun-darwin-${arch}`,
      ext: "",
    };
  }

  if (platform === "win32") {
    return {
      name: "windows-x64",
      target: "bun-windows-x64",
      ext: ".exe",
    };
  }

  // Default to linux
  return {
    name: `linux-${arch}`,
    target: `bun-linux-${arch}`,
    ext: "",
  };
}

/**
 * Build for a single target
 */
async function buildTarget(target: BuildTarget): Promise<boolean> {
  const outfile = `dist/sentry-${target.name}${target.ext}`;

  console.log(`  Building ${target.name}...`);

  const result = await Bun.build({
    entrypoints: ["./src/bin.ts"],
    compile: {
      target: target.target as
        | "bun-darwin-arm64"
        | "bun-darwin-x64"
        | "bun-linux-x64"
        | "bun-linux-arm64"
        | "bun-windows-x64",
      outfile,
    },
    define: {
      SENTRY_CLI_VERSION: JSON.stringify(VERSION),
      SENTRY_CLIENT_ID_BUILD: JSON.stringify(SENTRY_CLIENT_ID),
    },
    sourcemap: "none",
  });

  if (!result.success) {
    console.error(`  Failed to build ${target.name}:`);
    for (const log of result.logs) {
      console.error(`    ${log}`);
    }
    return false;
  }

  console.log(`    -> ${outfile}`);
  return true;
}

/**
 * Main build function
 */
async function build(): Promise<void> {
  // Parse CLI args
  const args = process.argv.slice(2);
  const singleBuild = args.includes("--single");
  const includeBaseline = args.includes("--baseline");

  console.log(`\nSentry CLI Build v${VERSION}`);
  console.log("=".repeat(40));

  // Check for required build-time secrets
  if (!SENTRY_CLIENT_ID) {
    console.warn(
      "\n⚠️  Warning: SENTRY_CLIENT_ID not set. OAuth will not work in the built binary."
    );
    console.warn("   Set it via: SENTRY_CLIENT_ID=xxx bun run build\n");
  }

  // Determine targets
  let targets: BuildTarget[];

  if (singleBuild) {
    const currentTarget = getCurrentTarget();
    targets = [currentTarget];

    // Add baseline for current platform if requested
    if (includeBaseline && currentTarget.name.includes("x64")) {
      const baselineName = `${currentTarget.name}-baseline`;
      const baselineTarget = BASELINE_TARGETS.find(
        (t) => t.name === baselineName
      );
      if (baselineTarget) {
        targets.push(baselineTarget);
      }
    }

    console.log(`\nBuilding for current platform: ${currentTarget.name}`);
  } else {
    targets = [...STANDARD_TARGETS];
    if (includeBaseline) {
      targets.push(...BASELINE_TARGETS);
    }
    console.log(`\nBuilding for ${targets.length} targets`);
  }

  console.log("");

  // Build all targets
  let successCount = 0;
  let failCount = 0;

  for (const target of targets) {
    const success = await buildTarget(target);
    if (success) {
      successCount += 1;
    } else {
      failCount += 1;
    }
  }

  // Summary
  console.log(`\n${"=".repeat(40)}`);
  console.log(`Build complete: ${successCount} succeeded, ${failCount} failed`);

  if (failCount > 0) {
    process.exit(1);
  }
}

// Run build
await build();
