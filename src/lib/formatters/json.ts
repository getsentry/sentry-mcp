/**
 * JSON output utilities
 */

import type { Writer } from "../../types/index.js";

/**
 * Format data as pretty-printed JSON
 */
export function formatJson<T>(data: T): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Output JSON to a write stream
 */
export function writeJson<T>(stream: Writer, data: T): void {
  stream.write(`${formatJson(data)}\n`);
}
