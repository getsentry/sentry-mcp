#!/usr/bin/env bun
/**
 * Build script for Sentry CLI
 *
 * Creates standalone executables for multiple platforms using Bun.build().
 * Each platform gets its own npm package structure in dist/.
 *
 * Usage:
 *   bun run script/build.ts           # Build for all platforms
 *   bun run script/build.ts --single  # Build for current platform only
 *
 * Output structure:
 *   dist/
 *     sentry-darwin-arm64/
 *       bin/sentry
 *       package.json
 *     sentry-darwin-x64/
 *       bin/sentry
 *       package.json
 *     ...
 */

import { $ } from "bun";
import pkg from "../package.json";

const VERSION = pkg.version;

/**
 * Build-time constants injected into the binary
 */
const SENTRY_CLIENT_ID = process.env.SENTRY_CLIENT_ID ?? "";

/**
 * Build targets configuration
 */
type BuildTarget = {
  os: "darwin" | "linux" | "win32";
  arch: "arm64" | "x64";
};

const ALL_TARGETS: BuildTarget[] = [
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "win32", arch: "x64" },
];

/**
 * Get package name for a target (uses "windows" instead of "win32" for npm)
 */
function getPackageName(target: BuildTarget): string {
  const platformName = target.os === "win32" ? "windows" : target.os;
  return `sentry-${platformName}-${target.arch}`;
}

/**
 * Get Bun compile target string
 */
function getBunTarget(target: BuildTarget): string {
  return `bun-${target.os}-${target.arch}`;
}

/**
 * Build for a single target
 */
async function buildTarget(target: BuildTarget): Promise<boolean> {
  const packageName = getPackageName(target);
  const binaryName = target.os === "win32" ? "sentry.exe" : "sentry";
  const outfile = `dist/${packageName}/bin/${binaryName}`;

  console.log(`  Building ${packageName}...`);

  // Create directory structure
  await $`mkdir -p dist/${packageName}/bin`;

  const result = await Bun.build({
    entrypoints: ["./src/bin.ts"],
    compile: {
      target: getBunTarget(target) as
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
    console.error(`  Failed to build ${packageName}:`);
    for (const log of result.logs) {
      console.error(`    ${log}`);
    }
    return false;
  }

  // Create package.json for this platform package
  // Note: os field uses "win32" for Windows (npm's convention)
  await Bun.file(`dist/${packageName}/package.json`).write(
    JSON.stringify(
      {
        name: packageName,
        version: VERSION,
        os: [target.os],
        cpu: [target.arch],
        description: "Platform-specific binary for @betegon/sentry CLI",
      },
      null,
      2
    )
  );

  console.log(`    -> ${outfile}`);
  return true;
}

/**
 * Main build function
 */
async function build(): Promise<Record<string, string>> {
  const args = process.argv.slice(2);
  const singleBuild = args.includes("--single");

  console.log(`\nSentry CLI Build v${VERSION}`);
  console.log("=".repeat(40));

  if (!SENTRY_CLIENT_ID) {
    console.warn(
      "\nWarning: SENTRY_CLIENT_ID not set. OAuth will not work in the built binary."
    );
    console.warn("   Set it via: SENTRY_CLIENT_ID=xxx bun run build\n");
  }

  // Determine targets
  let targets: BuildTarget[];

  if (singleBuild) {
    const currentTarget = ALL_TARGETS.find(
      (t) => t.os === process.platform && t.arch === process.arch
    );
    if (!currentTarget) {
      console.error(
        `Unsupported platform: ${process.platform}-${process.arch}`
      );
      process.exit(1);
    }
    targets = [currentTarget];
    console.log(
      `\nBuilding for current platform: ${getPackageName(currentTarget)}`
    );
  } else {
    targets = ALL_TARGETS;
    console.log(`\nBuilding for ${targets.length} targets`);
  }

  // Clean dist directory
  await $`rm -rf dist`;

  console.log("");

  // Build all targets
  const binaries: Record<string, string> = {};
  let successCount = 0;
  let failCount = 0;

  for (const target of targets) {
    const success = await buildTarget(target);
    if (success) {
      successCount += 1;
      binaries[getPackageName(target)] = VERSION;
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

  return binaries;
}

// Run build and export binaries for use by package.ts
const binaries = await build();
export { binaries, VERSION };
