#!/usr/bin/env bun
/**
 * Package script for Sentry CLI
 *
 * Creates the main @betegon/sentry package with:
 * - bin/sentry launcher script (Node.js)
 * - package.json with optionalDependencies on platform packages
 *
 * Run this after build.ts to prepare all packages for publishing.
 *
 * Usage:
 *   bun run script/package.ts
 *
 * Output:
 *   dist/@betegon/sentry/
 *     bin/sentry
 *     package.json
 */

import { $ } from "bun";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliDir = path.resolve(__dirname, "..");

process.chdir(cliDir);

// Import binaries from build (assumes build.ts was run)
import pkg from "../package.json";

const VERSION = pkg.version;
const MAIN_PACKAGE_NAME = "@betegon/sentry";

// Platform packages that should exist in dist/
const PLATFORM_PACKAGES = [
  "sentry-darwin-arm64",
  "sentry-darwin-x64",
  "sentry-linux-arm64",
  "sentry-linux-x64",
  "sentry-windows-x64",
];

async function packageMain(): Promise<void> {
  console.log(`\nPackaging ${MAIN_PACKAGE_NAME} v${VERSION}`);
  console.log("=".repeat(40));

  // Verify platform packages exist
  console.log("\nVerifying platform packages...");
  const binaries: Record<string, string> = {};

  for (const name of PLATFORM_PACKAGES) {
    const pkgPath = `dist/${name}/package.json`;
    const exists = await Bun.file(pkgPath).exists();
    if (exists) {
      binaries[name] = VERSION;
      console.log(`  Found ${name}`);
    } else {
      console.warn(`  Warning: ${name} not found - run build.ts first`);
    }
  }

  if (Object.keys(binaries).length === 0) {
    console.error("\nNo platform packages found. Run build.ts first:");
    console.error("  bun run script/build.ts");
    process.exit(1);
  }

  // Create main package directory
  const mainPkgDir = `dist/${MAIN_PACKAGE_NAME.replace("/", "-")}`;
  await $`mkdir -p ${mainPkgDir}/bin`;

  // Copy launcher script
  console.log("\nCopying launcher script...");
  await $`cp bin/sentry ${mainPkgDir}/bin/sentry`;
  await $`chmod +x ${mainPkgDir}/bin/sentry`;
  console.log(`  -> ${mainPkgDir}/bin/sentry`);

  // Create package.json for main package
  console.log("\nCreating package.json...");
  const mainPkg = {
    name: MAIN_PACKAGE_NAME,
    version: VERSION,
    description: "A gh-like CLI for Sentry",
    bin: {
      sentry: "./bin/sentry",
    },
    optionalDependencies: binaries,
    repository: {
      type: "git",
      url: "https://github.com/betegon/sentry-cli-next",
    },
    license: "MIT",
    engines: {
      node: ">=18",
    },
  };

  await Bun.file(`${mainPkgDir}/package.json`).write(
    JSON.stringify(mainPkg, null, 2)
  );
  console.log(`  -> ${mainPkgDir}/package.json`);

  // Summary
  console.log(`\n${"=".repeat(40)}`);
  console.log("Packaging complete!");
  console.log("\nPackages ready for publishing:");
  console.log(`  Main:     ${mainPkgDir}/`);
  for (const name of Object.keys(binaries)) {
    console.log(`  Platform: dist/${name}/`);
  }

  console.log("\nTo publish manually:");
  console.log("  # First, publish platform packages:");
  for (const name of Object.keys(binaries)) {
    console.log(`  cd dist/${name} && npm publish --access public && cd ../..`);
  }
  console.log("\n  # Then, publish main package:");
  console.log(`  cd ${mainPkgDir} && npm publish --access public`);
}

await packageMain();
