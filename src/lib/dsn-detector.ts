/**
 * DSN Detector
 *
 * Automatically detects Sentry DSN from various sources:
 * 1. Environment variable (SENTRY_DSN)
 * 2. .env files in the current directory
 * 3. Code analysis using ast-grep (Sentry.init patterns)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DetectedDsn, DsnSource } from "../types/index.js";
import { parseDsn } from "./dsn.js";

/**
 * Environment variable name for Sentry DSN
 */
const SENTRY_DSN_ENV = "SENTRY_DSN";

/**
 * .env file names to search (in priority order)
 */
const ENV_FILES = [
  ".env.local",
  ".env.development.local",
  ".env.production.local",
  ".env",
  ".env.development",
  ".env.production",
];

/**
 * File extensions to search for Sentry.init patterns
 */
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * Create a DetectedDsn from a raw DSN string
 */
function createDetectedDsn(
  raw: string,
  source: DsnSource,
  sourcePath?: string
): DetectedDsn | null {
  const parsed = parseDsn(raw);
  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    raw,
    source,
    sourcePath,
  };
}

/**
 * Detect DSN from environment variable
 */
function detectFromEnv(): DetectedDsn | null {
  const dsn = process.env[SENTRY_DSN_ENV];
  if (!dsn) {
    return null;
  }

  return createDetectedDsn(dsn, "env");
}

/**
 * Parse a .env file and extract SENTRY_DSN value
 */
function parseEnvFile(content: string): string | null {
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Match SENTRY_DSN=value or SENTRY_DSN="value" or SENTRY_DSN='value'
    const match = trimmed.match(/^SENTRY_DSN\s*=\s*(['"]?)(.+?)\1\s*(?:#.*)?$/);
    if (match?.[2]) {
      return match[2];
    }
  }

  return null;
}

/**
 * Detect DSN from .env files in the given directory
 */
function detectFromEnvFiles(cwd: string): DetectedDsn | null {
  for (const filename of ENV_FILES) {
    const filepath = join(cwd, filename);

    if (!existsSync(filepath)) {
      continue;
    }

    try {
      const content = readFileSync(filepath, "utf-8");
      const dsn = parseEnvFile(content);

      if (dsn) {
        return createDetectedDsn(dsn, "env_file", filepath);
      }
    } catch {
      // Skip files we can't read
    }
  }

  return null;
}

/**
 * Extract DSN string from Sentry.init code using regex
 * This is a simpler alternative to ast-grep for basic cases
 */
function extractDsnFromCode(content: string): string | null {
  // Match patterns like:
  // Sentry.init({ dsn: "..." })
  // Sentry.init({ dsn: '...' })
  // Sentry.init({ dsn: `...` })
  const patterns = [
    /Sentry\.init\s*\(\s*\{[^}]*dsn\s*:\s*["'`]([^"'`]+)["'`]/s,
    /dsn\s*:\s*["'`](https?:\/\/[^"'`]+@[^"'`]+)["'`]/s,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Recursively find source files in a directory (limited depth)
 */
function findSourceFiles(
  dir: string,
  maxDepth = 3,
  currentDepth = 0
): string[] {
  if (currentDepth >= maxDepth) {
    return [];
  }

  const files: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip common non-source directories
      if (
        entry.isDirectory() &&
        ![
          "node_modules",
          ".git",
          "dist",
          "build",
          ".next",
          "coverage",
        ].includes(entry.name)
      ) {
        files.push(
          ...findSourceFiles(join(dir, entry.name), maxDepth, currentDepth + 1)
        );
      } else if (entry.isFile()) {
        const ext = entry.name.slice(entry.name.lastIndexOf("."));
        if (CODE_EXTENSIONS.includes(ext)) {
          files.push(join(dir, entry.name));
        }
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return files;
}

/**
 * Detect DSN from source code using ast-grep (if available) or regex fallback
 */
async function detectFromCode(cwd: string): Promise<DetectedDsn | null> {
  // Try to use ast-grep if available
  try {
    const { js } = await import("@ast-grep/napi");
    // ast-grep implementation would go here
    // For now, fall through to regex-based detection
  } catch {
    // ast-grep not available, use regex fallback
  }

  // Regex-based detection
  const sourceFiles = findSourceFiles(cwd);

  for (const filepath of sourceFiles) {
    try {
      const content = readFileSync(filepath, "utf-8");
      const dsn = extractDsnFromCode(content);

      if (dsn) {
        return createDetectedDsn(dsn, "code", filepath);
      }
    } catch {
      // Skip files we can't read
    }
  }

  return null;
}

/**
 * Detect Sentry DSN from the current working directory
 *
 * Searches in priority order:
 * 1. SENTRY_DSN environment variable
 * 2. .env files (.env.local, .env, etc.)
 * 3. Source code (Sentry.init patterns)
 *
 * @param cwd - Directory to search in
 * @returns Detected DSN with source information, or null if not found
 *
 * @example
 * const dsn = await detectDsn(process.cwd());
 * if (dsn) {
 *   console.log(`Found DSN from ${dsn.source}: org ${dsn.orgId}, project ${dsn.projectId}`);
 * }
 */
export async function detectDsn(cwd: string): Promise<DetectedDsn | null> {
  // 1. Check environment variable first (highest priority)
  const envDsn = detectFromEnv();
  if (envDsn) {
    return envDsn;
  }

  // 2. Check .env files
  const envFileDsn = detectFromEnvFiles(cwd);
  if (envFileDsn) {
    return envFileDsn;
  }

  // 3. Search source code
  const codeDsn = await detectFromCode(cwd);
  if (codeDsn) {
    return codeDsn;
  }

  return null;
}

/**
 * Get a human-readable description of the DSN source
 */
export function getDsnSourceDescription(dsn: DetectedDsn): string {
  switch (dsn.source) {
    case "env":
      return "SENTRY_DSN environment variable";
    case "env_file":
      return dsn.sourcePath ?? ".env file";
    case "code":
      return dsn.sourcePath ?? "source code";
  }
}
