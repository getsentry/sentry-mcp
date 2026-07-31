/**
 * SQLite database connection manager for CLI configuration storage.
 * Uses the sqlite.ts adapter, which selects `node:sqlite` (Node 22.15+) or a
 * bundled WASM driver (`node-sqlite3-wasm`, Node < 22.15) behind one API.
 */

import { chmodSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { getEnv } from "../env.js";
import { logger } from "../logger.js";

const _require = createRequire(import.meta.url);

const log = logger.withTag("db");

import { migrateFromJson } from "./migration.js";
import { initSchema, runMigrations } from "./schema.js";
import { Database } from "./sqlite.js";

export const CONFIG_DIR_ENV_VAR = "SENTRY_CONFIG_DIR";

const DEFAULT_CONFIG_DIR_NAME = ".sentry";

const DB_FILENAME = "cli.db";

/** 7-day TTL for cache entries (milliseconds) */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Probability of running cleanup on write operations */
const CLEANUP_PROBABILITY = 0.1;

/** Traced database wrapper (returned by getDatabase) */
let db: Database | null = null;
/** Raw database without tracing (used for repair operations) */
let rawDb: Database | null = null;
let dbOpenedPath: string | null = null;

/**
 * Whether the process-exit close handler has been registered.
 *
 * On the WASM fallback (`node-sqlite3-wasm`, Node < 22.15), the driver
 * releases its `<db>.lock` mutex during `close()` — the adapter's `.get()`
 * wrapper finalizes cursors so this happens reliably. Explicitly closing on
 * a normal `exit` is a proactive backstop that shrinks the window in which a
 * lock could linger; it does NOT fire on SIGKILL/SIGINT, so it is not the
 * primary guarantee. A lock orphaned by a signal-killed process is recovered
 * at the next open by `clearStaleWasmLock`, which uses the PID-owner sentinel
 * to clear it immediately once the owner is gone. Harmless (and cheap) for the
 * native driver too.
 */
let exitHandlerRegistered = false;

function registerExitHandler(): void {
  if (exitHandlerRegistered) {
    return;
  }
  exitHandlerRegistered = true;
  // 'exit' handlers must be synchronous; close() is synchronous.
  process.on("exit", () => {
    try {
      db?.close();
    } catch (error) {
      // Best-effort: the process is exiting anyway. A failed close here
      // must never mask the real exit code.
      log.debug("Failed to close database on exit", error);
    }
  });
}

export function getConfigDir(): string {
  const { homedir } = _require("node:os");
  return (
    getEnv()[CONFIG_DIR_ENV_VAR] || join(homedir(), DEFAULT_CONFIG_DIR_NAME)
  );
}

export function getDbPath(): string {
  return join(getConfigDir(), DB_FILENAME);
}

function ensureConfigDir(): void {
  mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
}

function setDbPermissions(): void {
  const dbPath = getDbPath();
  try {
    chmodSync(dbPath, 0o600);
    // WAL mode creates -wal and -shm files that may contain sensitive data
    // Chmod them too if they exist (they may not exist on first run)
    try {
      chmodSync(`${dbPath}-wal`, 0o600);
    } catch {
      // File may not exist yet
    }
    try {
      chmodSync(`${dbPath}-shm`, 0o600);
    } catch {
      // File may not exist yet
    }
  } catch {
    // Windows doesn't support chmod
  }
}

/** Get or initialize the database connection. */
export function getDatabase(): Database {
  const dbPath = getDbPath();

  // Auto-invalidate if config directory changed (for tests)
  if (db && dbOpenedPath !== dbPath) {
    db.close();
    db = null;
    rawDb = null;
    dbOpenedPath = null;
  }

  if (db) {
    return db;
  }

  ensureConfigDir();

  rawDb = new Database(dbPath);

  try {
    // 5000ms busy_timeout prevents SQLITE_BUSY errors during concurrent CLI access.
    // When multiple CLI instances run simultaneously (e.g., parallel terminals, CI jobs),
    // SQLite needs time to acquire locks. WAL mode allows concurrent reads, but writers
    // must wait. Without sufficient timeout, concurrent processes fail immediately.
    // Set busy_timeout FIRST - before WAL mode - to handle lock contention during init.
    rawDb.exec("PRAGMA busy_timeout = 5000");
    // WAL is only supported by the native node:sqlite driver. The WASM fallback
    // (Node < 22.15) silently ignores it and stays in the default rollback
    // journal — acceptable for a single-process CLI cache — so skip the no-op
    // pragma there rather than pretend it took effect.
    if (rawDb.driverKind === "node") {
      rawDb.exec("PRAGMA journal_mode = WAL");
    }
    rawDb.exec("PRAGMA foreign_keys = ON");
    rawDb.exec("PRAGMA synchronous = NORMAL");

    setDbPermissions();
    initSchema(rawDb);
    runMigrations(rawDb);
    migrateFromJson(rawDb);

    // Wrap with tracing proxy for automatic query instrumentation.
    // Lazy-require telemetry to avoid top-level import of @sentry/node-core (~85ms).
    // Shell completions set SENTRY_CLI_NO_TELEMETRY=1 to skip this entirely.
    if (getEnv().SENTRY_CLI_NO_TELEMETRY === "1") {
      db = rawDb;
    } else {
      const { createTracedDatabase } = _require("../telemetry.js") as {
        createTracedDatabase: (d: Database) => Database;
      };
      db = createTracedDatabase(rawDb);
    }
    dbOpenedPath = dbPath;
    registerExitHandler();

    return db;
  } catch (error) {
    // Clean up on initialization failure to prevent connection leak
    rawDb.close();
    rawDb = null;
    throw error;
  }
}

/** Close the database connection (used for testing). */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    rawDb = null;
    dbOpenedPath = null;
  }
}

/**
 * Get the raw (unwrapped) database connection.
 * Used for repair operations to avoid triggering the traced wrapper's
 * auto-repair logic (which would cause infinite loops).
 */
export function getRawDatabase(): Database {
  if (!rawDb) {
    // Ensure database is initialized
    getDatabase();
  }
  // After getDatabase() call, rawDb is guaranteed to be set
  if (!rawDb) {
    throw new Error("Database initialization failed");
  }
  return rawDb;
}

function shouldRunCleanup(): boolean {
  return Math.random() < CLEANUP_PROBABILITY;
}

function cleanupExpiredCaches(): void {
  const database = getDatabase();
  const expiryTime = Date.now() - CACHE_TTL_MS;
  const now = Date.now();

  database
    .query("DELETE FROM project_cache WHERE last_accessed < ?")
    .run(expiryTime);
  database
    .query("DELETE FROM dsn_cache WHERE last_accessed < ?")
    .run(expiryTime);
  database
    .query("DELETE FROM project_aliases WHERE last_accessed < ?")
    .run(expiryTime);
  // project_root_cache uses ttl_expires_at instead of last_accessed
  database
    .query("DELETE FROM project_root_cache WHERE ttl_expires_at < ?")
    .run(now);
}

export function maybeCleanupCaches(): void {
  if (shouldRunCleanup()) {
    cleanupExpiredCaches();
  }
}
