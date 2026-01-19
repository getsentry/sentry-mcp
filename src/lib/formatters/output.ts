/**
 * Shared output utilities
 *
 * Handles the common pattern of JSON vs human-readable output
 * that appears in most CLI commands.
 */

import type { Writer } from "../../types/index.js";
import { writeJson } from "./json.js";

type WriteOutputOptions<T> = {
  /** Output JSON format instead of human-readable */
  json: boolean;
  /** Function to format data as human-readable lines */
  formatHuman: (data: T) => string[];
  /** Optional source description if data was auto-detected */
  detectedFrom?: string;
};

/**
 * Write formatted output to stdout based on output format.
 * Handles the common JSON vs human-readable pattern used across commands.
 *
 * @param stdout - Writer to output to
 * @param data - Data to output
 * @param options - Output options including format and formatters
 */
export function writeOutput<T>(
  stdout: Writer,
  data: T,
  options: WriteOutputOptions<T>
): void {
  if (options.json) {
    writeJson(stdout, data);
    return;
  }

  const lines = options.formatHuman(data);
  stdout.write(`${lines.join("\n")}\n`);

  if (options.detectedFrom) {
    stdout.write(`\nDetected from ${options.detectedFrom}\n`);
  }
}
