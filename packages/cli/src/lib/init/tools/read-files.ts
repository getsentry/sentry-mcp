import fs from "node:fs";
import { MAX_FILE_BYTES } from "../constants.js";
import type { ReadFilesPayload, ToolResult } from "../types.js";
import { safePath } from "./shared.js";
import type { InitToolDefinition } from "./types.js";

const PATH_SEGMENT_RE = /[/\\]/u;

/**
 * Read one or more files from the sandboxed project directory.
 */
export async function readFiles(
  payload: ReadFilesPayload
): Promise<ToolResult> {
  const maxBytes = payload.params.maxBytes ?? MAX_FILE_BYTES;
  const results = await Promise.all(
    payload.params.paths.map(async (filePath) => {
      const content = await readSingleFile(payload.cwd, filePath, maxBytes);
      return [filePath, content] as const;
    })
  );

  const files: Record<string, string | null> = {};
  for (const [filePath, content] of results) {
    files[filePath] = content;
  }

  return { ok: true, data: { files } };
}

async function readSingleFile(
  cwd: string,
  filePath: string,
  maxBytes: number
): Promise<string | null> {
  try {
    const absPath = safePath(cwd, filePath);
    const stat = await fs.promises.stat(absPath);
    // Guard against FIFOs / sockets / devices — both `readFile` and
    // `open("r")` block indefinitely on a FIFO waiting for a writer.
    // `stat` follows symlinks, so symlink → FIFO is caught too.
    if (!stat.isFile()) {
      return null;
    }
    if (stat.size <= maxBytes) {
      return await fs.promises.readFile(absPath, "utf-8");
    }

    const handle = await fs.promises.open(absPath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      await handle.read(buffer, 0, maxBytes, 0);
      return buffer.toString("utf-8");
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * Tool definition for batched file reads.
 */
export const readFilesTool: InitToolDefinition<"read-files"> = {
  operation: "read-files",
  describe: (payload) => {
    const [first, second] = payload.params.paths;
    if (!first) {
      return "Reading files...";
    }
    if (!second && payload.params.paths.length === 1) {
      return `Reading \`${pathBase(first)}\`...`;
    }
    if (payload.params.paths.length === 2 && second) {
      return `Reading \`${pathBase(first)}\`, \`${pathBase(second)}\`...`;
    }
    return `Reading ${payload.params.paths.length} files (\`${pathBase(first)}\`${second ? `, \`${pathBase(second)}\`` : ""}, ...)...`;
  },
  execute: readFiles,
};

function pathBase(filePath: string): string {
  const parts = filePath.split(PATH_SEGMENT_RE);
  return parts.at(-1) ?? filePath;
}
