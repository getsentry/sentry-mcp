/**
 * DSN Detector
 *
 * Detects Sentry DSN with GitHub CLI-style caching.
 *
 * Fast path (cache hit): ~5ms - verify single file
 * Slow path (cache miss): ~2-5s - full scan
 *
 * Detection priority (explicit code DSN wins):
 * 1. Source code (explicit DSN in Sentry.init, etc.)
 * 2. .env files (.env.local, .env, etc.)
 * 3. SENTRY_DSN environment variable
 */

import { extname, join } from "node:path";
import { getCachedDsn, setCachedDsn } from "./cache.js";
import { detectFromEnv, SENTRY_DSN_ENV } from "./env.js";
import {
  detectFromAllEnvFiles,
  detectFromEnvFiles,
  extractDsnFromEnvFile,
} from "./env-file.js";
import {
  detectAllFromCode,
  detectFromCode,
  languageDetectors,
} from "./languages/index.js";
import { createDetectedDsn, parseDsn } from "./parser.js";
import type {
  CachedDsnEntry,
  DetectedDsn,
  DsnDetectionResult,
  DsnSource,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Main API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect DSN with caching support
 *
 * Fast path (cache hit): ~5ms
 * Slow path (cache miss): ~2-5s
 *
 * Priority: code > .env files > SENTRY_DSN env var
 *
 * @param cwd - Directory to search in
 * @returns Detected DSN with source info, or null if not found
 */
export async function detectDsn(cwd: string): Promise<DetectedDsn | null> {
  // 1. Check cache for this directory (fast path)
  const cached = await getCachedDsn(cwd);

  if (cached) {
    // 2. Verify cached source file still has same DSN
    const verified = await verifyCachedDsn(cwd, cached);
    if (verified) {
      // Check if DSN changed
      if (verified.raw !== cached.dsn) {
        // DSN changed - update cache
        await setCachedDsn(cwd, {
          dsn: verified.raw,
          projectId: verified.projectId,
          orgId: verified.orgId,
          source: verified.source,
          sourcePath: verified.sourcePath,
        });
        return verified;
      }

      // Cache hit! Return with resolved info if available
      return {
        ...verified,
        resolved: cached.resolved,
      };
    }
    // Cache invalid, fall through to full scan
  }

  // 3. Full scan (cache miss): code → .env → env var
  const detected = await fullScanFirst(cwd);

  if (detected) {
    // 4. Cache for next time (without resolved info yet)
    await setCachedDsn(cwd, {
      dsn: detected.raw,
      projectId: detected.projectId,
      orgId: detected.orgId,
      source: detected.source,
      sourcePath: detected.sourcePath,
    });
  }

  return detected;
}

/**
 * Detect all DSNs in a directory (for conflict detection)
 *
 * Unlike detectDsn, this finds ALL DSNs from all sources.
 * Used when we need to check for conflicts.
 *
 * Collection order matches priority: code > .env files > env var
 *
 * @param cwd - Directory to search in
 * @returns Detection result with all found DSNs and conflict status
 */
export async function detectAllDsns(cwd: string): Promise<DsnDetectionResult> {
  const allDsns: DetectedDsn[] = [];
  const seenRawDsns = new Set<string>();

  // Helper to add DSN if not duplicate
  const addDsn = (dsn: DetectedDsn) => {
    if (!seenRawDsns.has(dsn.raw)) {
      allDsns.push(dsn);
      seenRawDsns.add(dsn.raw);
    }
  };

  // 1. Check all code files (highest priority)
  const codeDsns = await detectAllFromCode(cwd);
  for (const dsn of codeDsns) {
    addDsn(dsn);
  }

  // 2. Check all .env files
  const envFileDsns = await detectFromAllEnvFiles(cwd);
  for (const dsn of envFileDsns) {
    addDsn(dsn);
  }

  // 3. Check env var (lowest priority)
  const envDsn = detectFromEnv();
  if (envDsn) {
    addDsn(envDsn);
  }

  // Determine if there's a conflict (multiple DIFFERENT DSNs)
  const uniqueRawDsns = new Set(allDsns.map((d) => d.raw));
  const conflict = uniqueRawDsns.size > 1;

  return {
    primary: conflict ? null : (allDsns[0] ?? null),
    all: allDsns,
    conflict,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache Verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify cached DSN is still valid by reading ONLY the cached source file
 *
 * This is the key to fast cache hits - we only read ONE file.
 *
 * @param cwd - Directory
 * @param cached - Cached DSN entry
 * @returns Verified DSN or null if cache is invalid
 */
async function verifyCachedDsn(
  cwd: string,
  cached: CachedDsnEntry
): Promise<DetectedDsn | null> {
  // For env source, we already checked above in detectDsn
  if (cached.source === "env") {
    return null;
  }

  // Need a source path to verify
  if (!cached.sourcePath) {
    return null;
  }

  const filePath = join(cwd, cached.sourcePath);

  try {
    const content = await Bun.file(filePath).text();
    const foundDsn = extractDsnFromContent(
      content,
      cached.source,
      cached.sourcePath
    );

    if (foundDsn === cached.dsn) {
      // Same DSN - cache is valid!
      return createDetectedDsn(cached.dsn, cached.source, cached.sourcePath);
    }

    if (foundDsn && parseDsn(foundDsn)) {
      // DSN changed - return new one (cache will be updated by caller)
      return createDetectedDsn(foundDsn, cached.source, cached.sourcePath);
    }
  } catch {
    // File doesn't exist or can't read - cache is invalid
  }

  return null;
}

/**
 * Extract DSN from content based on source type and file path.
 *
 * @param content - File content
 * @param source - Source type (env_file, code, etc.)
 * @param sourcePath - Path to the file (used to determine language for code files)
 */
function extractDsnFromContent(
  content: string,
  source: DsnSource,
  sourcePath?: string
): string | null {
  switch (source) {
    case "env_file":
      return extractDsnFromEnvFile(content);
    case "code": {
      if (!sourcePath) {
        return null;
      }
      // Find the right language detector based on file extension
      const ext = extname(sourcePath);
      const detector = languageDetectors.find((d) =>
        d.extensions.includes(ext)
      );
      return detector?.extractDsn(content) ?? null;
    }
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Full Scan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full scan to find first DSN (cache miss path)
 *
 * Searches in priority order:
 * 1. Source code (explicit DSN takes highest priority)
 * 2. .env files
 * 3. SENTRY_DSN environment variable (lowest priority)
 */
async function fullScanFirst(cwd: string): Promise<DetectedDsn | null> {
  // 1. Search source code first (explicit DSN = highest priority)
  const codeDsn = await detectFromCode(cwd);
  if (codeDsn) {
    return codeDsn;
  }

  // 2. Check .env files
  const envFileDsn = await detectFromEnvFiles(cwd);
  if (envFileDsn) {
    return envFileDsn;
  }

  // 3. Check SENTRY_DSN environment variable (lowest priority)
  const envDsn = detectFromEnv();
  if (envDsn) {
    return envDsn;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a human-readable description of where DSN was found
 *
 * @param dsn - Detected DSN
 * @returns Description string for display
 */
export function getDsnSourceDescription(dsn: DetectedDsn): string {
  switch (dsn.source) {
    case "env":
      return `${SENTRY_DSN_ENV} environment variable`;
    case "env_file":
      return dsn.sourcePath ?? ".env file";
    case "config":
      return dsn.sourcePath ?? "config file";
    case "code":
      return dsn.sourcePath ?? "source code";
    default:
      return "unknown source";
  }
}
