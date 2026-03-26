import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { CachedToken } from "./types";

/** Safety window: treat tokens as expired 5 minutes before actual expiry. */
const EXPIRY_SAFETY_MS = 5 * 60 * 1000;

function getCacheFilePath(): string {
  if (process.env.SENTRY_MCP_AUTH_CACHE) {
    return process.env.SENTRY_MCP_AUTH_CACHE;
  }
  return path.join(os.homedir(), ".sentry", "mcp.json");
}

function cacheKey(host: string, clientId: string): string {
  return `${host}:${clientId}`;
}

type CacheFile = Record<string, CachedToken>;

async function readCacheFile(): Promise<CacheFile> {
  try {
    const raw = await fs.readFile(getCacheFilePath(), "utf-8");
    return JSON.parse(raw) as CacheFile;
  } catch {
    return {};
  }
}

async function writeCacheFile(data: CacheFile): Promise<void> {
  const filePath = getCacheFilePath();
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true, mode: 0o700 });

  // Atomic write: write to temp file then rename
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.rename(tmpPath, filePath);
}

export async function readCachedToken(
  host: string,
  clientId: string,
): Promise<CachedToken | null> {
  const data = await readCacheFile();
  const entry = data[cacheKey(host, clientId)];
  if (!entry) return null;

  const expiresAt = new Date(entry.expires_at).getTime();
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt - Date.now() <= EXPIRY_SAFETY_MS
  ) {
    // Token expired or about to expire — clear it
    await clearCachedToken(host, clientId);
    return null;
  }

  return entry;
}

export async function writeCachedToken(token: CachedToken): Promise<void> {
  const data = await readCacheFile();
  data[cacheKey(token.sentry_host, token.client_id)] = token;
  await writeCacheFile(data);
}

export async function clearCachedToken(
  host: string,
  clientId: string,
): Promise<void> {
  const data = await readCacheFile();
  const key = cacheKey(host, clientId);
  if (key in data) {
    delete data[key];
    await writeCacheFile(data);
  }
}
