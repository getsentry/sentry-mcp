import type fs from "node:fs";
import { MAX_FILE_BYTES } from "../constants.js";
import type {
  ReadFileErrorCode,
  ReadFilesPayload,
  ReadFilesV2Data,
  ReadFileV2Result,
  ToolResult,
} from "../types.js";
import {
  type OpenedProjectFile,
  openProjectFile,
  projectFileChanged,
} from "./project-file.js";
import type { InitToolDefinition } from "./types.js";

const DEFAULT_MAX_LINES = 1000;
const MAX_SCAN_BYTES = 4 * 1024 * 1024;
const MAX_V2_CONTENT_BYTES = 40_000;
const MAX_READ_LINES = 2000;
const MAX_READ_PATHS = 20;
const PATH_SEGMENT_RE = /[/\\\\]/u;

type ReadBounds = {
  maxBytes: number;
  maxLines: number;
  startLine: number;
};

/**
 * Read one or more files from the sandboxed project directory.
 *
 * Legacy requests keep their original string-or-null response. V2 requests
 * return independent, bounded line ranges; callers may issue another read or
 * use grep when they need different evidence. The CLI keeps no continuation
 * state between calls.
 */
export async function readFiles(
  payload: ReadFilesPayload
): Promise<ToolResult> {
  const error = validateReadRequest(payload);
  if (error) {
    return { error, ok: false };
  }

  if (payload.params.resultVersion === 2) {
    return readFilesV2(payload, boundedV2MaxBytes(payload.params.maxBytes));
  }
  const maxBytes = boundedLegacyMaxBytes(payload.params.maxBytes);

  const results = await Promise.all(
    payload.params.paths.map(async (filePath) => {
      const content = await readSingleFileV1(payload.cwd, filePath, maxBytes);
      return [filePath, content] as const;
    })
  );

  return {
    data: { files: Object.fromEntries(results) },
    ok: true,
  };
}

/** Preserve the wire behavior expected by APIs predating read-files v2. */
async function readSingleFileV1(
  cwd: string,
  filePath: string,
  maxBytes: number
): Promise<string | null> {
  let opened: OpenedProjectFile | undefined;
  try {
    const result = await openProjectFile(cwd, filePath);
    if ("error" in result) {
      return null;
    }
    opened = result;
    const bytesToRead = Math.min(opened.stat.size, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    await opened.handle.read(buffer, 0, bytesToRead, 0);
    if (projectFileChanged(opened.stat, await opened.handle.stat())) {
      return null;
    }
    return buffer.toString("utf-8");
  } catch {
    return null;
  } finally {
    await opened?.handle.close().catch(() => {
      // Preserve the legacy null-or-string result when cleanup fails.
    });
  }
}

async function readFilesV2(
  payload: ReadFilesPayload,
  maxBytes: number
): Promise<ToolResult> {
  const startLine = payload.params.startLine ?? 1;
  const maxLines = boundedMaxLines(payload.params.maxLines);
  const perFileMaxBytes = Math.min(
    maxBytes,
    Math.max(1, Math.floor(MAX_V2_CONTENT_BYTES / payload.params.paths.length))
  );
  const bounds = {
    maxBytes: perFileMaxBytes,
    maxLines,
    startLine,
  } satisfies ReadBounds;
  const results = await Promise.all(
    payload.params.paths.map(async (filePath) => {
      const result = await readSingleFileV2(payload.cwd, filePath, bounds);
      return [filePath, result] as const;
    })
  );

  return {
    data: {
      files: Object.fromEntries(results),
      version: 2,
    } satisfies ReadFilesV2Data,
    ok: true,
  };
}

async function readSingleFileV2(
  cwd: string,
  filePath: string,
  bounds: ReadBounds
): Promise<ReadFileV2Result> {
  let opened: OpenedProjectFile | undefined;
  try {
    const result = await openProjectFile(cwd, filePath);
    if ("error" in result) {
      return { error: result.error, status: "error" };
    }
    opened = result;
    if (opened.stat.size === 0) {
      if (projectFileChanged(opened.stat, await opened.handle.stat())) {
        return { error: "unreadable", status: "error" };
      }
      return bounds.startLine === 1
        ? {
            content: "",
            status: "ok",
            truncated: false,
          }
        : { error: "invalid-range", status: "error" };
    }

    const page = await readTextPage(opened.handle, opened.stat.size, bounds);
    if (projectFileChanged(opened.stat, await opened.handle.stat())) {
      return { error: "unreadable", status: "error" };
    }
    return page;
  } catch (error) {
    return { error: readErrorCode(error), status: "error" };
  } finally {
    await opened?.handle.close().catch(() => {
      // Preserve the primary read result when descriptor cleanup fails.
    });
  }
}

async function readTextPage(
  handle: fs.promises.FileHandle,
  fileSize: number,
  bounds: ReadBounds
): Promise<ReadFileV2Result> {
  const scanBudget =
    bounds.startLine === 1 ? bounds.maxBytes : MAX_SCAN_BYTES + bounds.maxBytes;
  const scanBytes = Math.min(fileSize, scanBudget);
  const scanBuffer = Buffer.alloc(scanBytes);
  const { bytesRead } = await handle.read(scanBuffer, 0, scanBytes, 0);
  const readable = scanBuffer.subarray(0, bytesRead);
  if (!isTextBuffer(readable, bytesRead < fileSize)) {
    return { error: "not-text", status: "error" };
  }

  const startOffset = lineStartOffset(readable, bounds.startLine);
  if (startOffset === undefined) {
    return {
      error: bytesRead < fileSize ? "range-too-deep" : "invalid-range",
      status: "error",
    };
  }
  if (startOffset > MAX_SCAN_BYTES) {
    return { error: "range-too-deep", status: "error" };
  }
  const selected = selectCompleteLines(readable, fileSize, startOffset, bounds);
  if ("error" in selected) {
    return { error: selected.error, status: "error" };
  }
  return {
    content: selected.content.toString("utf-8"),
    status: "ok",
    truncated: startOffset + selected.content.length < fileSize,
  };
}

function lineStartOffset(
  buffer: Buffer,
  startLine: number
): number | undefined {
  let offset = 0;
  for (let line = 1; line < startLine; line += 1) {
    const newline = buffer.indexOf(0x0a, offset);
    if (newline === -1) {
      return;
    }
    offset = newline + 1;
  }
  return offset < buffer.length ? offset : undefined;
}

function selectCompleteLines(
  buffer: Buffer,
  fileSize: number,
  startOffset: number,
  bounds: ReadBounds
): { content: Buffer } | { error: "line-too-long" } {
  let offset = startOffset;
  for (let lines = 0; lines < bounds.maxLines; lines += 1) {
    const lineEnd = completeLineEnd(buffer, fileSize, offset);
    if (lineEnd === undefined) {
      return priorLinesOrError(buffer, startOffset, offset);
    }
    if (lineEnd - startOffset > bounds.maxBytes) {
      return priorLinesOrError(buffer, startOffset, offset);
    }
    offset = lineEnd;
    if (offset === buffer.length) {
      break;
    }
  }
  return { content: buffer.subarray(startOffset, offset) };
}

function completeLineEnd(
  buffer: Buffer,
  fileSize: number,
  offset: number
): number | undefined {
  const newline = buffer.indexOf(0x0a, offset);
  if (newline !== -1) {
    return newline + 1;
  }
  return buffer.length === fileSize ? buffer.length : undefined;
}

function priorLinesOrError(
  buffer: Buffer,
  startOffset: number,
  endOffset: number
): { content: Buffer } | { error: "line-too-long" } {
  return endOffset === startOffset
    ? { error: "line-too-long" }
    : { content: buffer.subarray(startOffset, endOffset) };
}

function validateReadRequest(payload: ReadFilesPayload): string | undefined {
  const params = (payload as { params?: unknown }).params;
  if (typeof params !== "object" || params === null) {
    return "read-files params must be an object";
  }
  const { maxBytes, maxLines, paths, resultVersion, startLine } =
    params as Partial<ReadFilesPayload["params"]>;
  const pathError = validateReadPaths(paths);
  if (pathError) {
    return pathError;
  }
  const validPaths = paths as string[];
  if (isInvalidPositiveInteger(maxBytes)) {
    return "read-files maxBytes must be a positive safe integer";
  }
  if (resultVersion !== undefined && resultVersion !== 2) {
    return "read-files resultVersion is not supported";
  }
  if (isInvalidPositiveInteger(startLine)) {
    return "read-files startLine must be a positive safe integer";
  }
  if (isInvalidPositiveInteger(maxLines)) {
    return "read-files maxLines must be a positive safe integer";
  }
  if (
    (startLine !== undefined || maxLines !== undefined) &&
    resultVersion !== 2
  ) {
    return "read-files line ranges require resultVersion 2";
  }
  if ((startLine ?? 1) > 1 && validPaths.length !== 1) {
    return "read-files range reads require exactly one path";
  }
}

function validateReadPaths(paths: unknown): string | undefined {
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    paths.length > MAX_READ_PATHS
  ) {
    return `read-files requires between 1 and ${MAX_READ_PATHS} paths`;
  }
  if (
    paths.some(
      (filePath) =>
        typeof filePath !== "string" ||
        filePath.length === 0 ||
        filePath.length > 1000
    )
  ) {
    return "read-files paths must be non-empty bounded strings";
  }
}

function isInvalidPositiveInteger(value: unknown): boolean {
  return (
    value !== undefined &&
    (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
  );
}

function boundedLegacyMaxBytes(value: number | undefined): number {
  return value === undefined
    ? MAX_FILE_BYTES
    : Math.max(1, Math.min(value, MAX_FILE_BYTES));
}

function boundedV2MaxBytes(value: number | undefined): number {
  return value === undefined
    ? MAX_V2_CONTENT_BYTES
    : Math.max(1, Math.min(value, MAX_V2_CONTENT_BYTES));
}

function boundedMaxLines(value: number | undefined): number {
  return value === undefined
    ? DEFAULT_MAX_LINES
    : Math.max(1, Math.min(value, MAX_READ_LINES));
}

function isTextBuffer(buffer: Buffer, mayEndMidCharacter: boolean): boolean {
  if (
    buffer.some(
      (byte) =>
        byte === 0x7f || (byte < 0x20 && ![0x09, 0x0a, 0x0d].includes(byte))
    )
  ) {
    return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer, {
      stream: mayEndMidCharacter,
    });
    return true;
  } catch {
    return false;
  }
}

function readErrorCode(error: unknown): ReadFileErrorCode {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "ENOENT") {
      return "not-found";
    }
    if (error.code === "EISDIR") {
      return "not-file";
    }
  }
  return "unreadable";
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
