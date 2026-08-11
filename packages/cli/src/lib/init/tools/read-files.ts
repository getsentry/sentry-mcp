import fs from "node:fs";
import { MAX_FILE_BYTES } from "../constants.js";
import type { FileReadResult, ReadFilesPayload, ToolResult } from "../types.js";
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
      const result = await readSingleFile(payload.cwd, filePath, maxBytes);
      return [filePath, result] as const;
    })
  );

  const files: Record<string, string | null> = {};
  const readResults: Record<string, FileReadResult> = {};
  for (const [filePath, result] of results) {
    files[filePath] = result.content;
    readResults[filePath] = result.metadata;
  }

  return { ok: true, data: { files, readResults } };
}

type SingleFileRead = {
  content: string | null;
  metadata: FileReadResult;
};

async function readSingleFile(
  cwd: string,
  filePath: string,
  maxBytes: number
): Promise<SingleFileRead> {
  try {
    const absPath = safePath(cwd, filePath);
    const stat = await fs.promises.stat(absPath);
    // Guard against FIFOs / sockets / devices — both `readFile` and
    // `open("r")` block indefinitely on a FIFO waiting for a writer.
    // `stat` follows symlinks, so symlink → FIFO is caught too.
    if (!stat.isFile()) {
      return {
        content: null,
        metadata: { status: "skipped", reason: "not-regular-file" },
      };
    }
    const buffer =
      stat.size <= maxBytes
        ? await fs.promises.readFile(absPath)
        : await readFilePrefix(absPath, maxBytes);

    return {
      content: buffer.toString("utf-8"),
      metadata: {
        status: stat.size > maxBytes ? "truncated" : "read",
        bytesRead: buffer.byteLength,
        totalBytes: stat.size,
      },
    };
  } catch (error) {
    return {
      content: null,
      metadata: { status: "error", reason: readFailureReason(error) },
    };
  }
}

function readFailureReason(error: unknown): FileReadResult["reason"] {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  if (code === "ENOENT") {
    return "not-found";
  }
  if (code === "EACCES" || code === "EPERM") {
    return "permission-denied";
  }
  if (error instanceof Error && error.message.includes("outside project")) {
    return "outside-project";
  }
  return "read-failed";
}

async function readFilePrefix(
  absPath: string,
  maxBytes: number
): Promise<Buffer> {
  const handle = await fs.promises.open(absPath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
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
