import fs from "node:fs";
import path from "node:path";
import { ApiError } from "../../errors.js";
import type { ToolPayload, ToolResult } from "../types.js";

/**
 * Resolve a path relative to cwd and verify it stays inside the project root.
 */
export function safePath(cwd: string, relative: string): string {
  const resolved = path.resolve(cwd, relative);
  const normalizedCwd = path.resolve(cwd);
  if (
    !resolved.startsWith(normalizedCwd + path.sep) &&
    resolved !== normalizedCwd
  ) {
    throw new Error(`Path "${relative}" resolves outside project directory`);
  }

  let realCwd: string;
  try {
    realCwd = fs.realpathSync(normalizedCwd);
  } catch {
    return resolved;
  }

  let checkPath = resolved;
  for (;;) {
    try {
      const real = fs.realpathSync(checkPath);
      if (!real.startsWith(realCwd + path.sep) && real !== realCwd) {
        throw new Error(
          `Path "${relative}" resolves outside project directory via symlink`
        );
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      const parent = path.dirname(checkPath);
      if (parent === checkPath) {
        break;
      }
      checkPath = parent;
    }
  }

  return resolved;
}

/**
 * Reject tool executions whose requested cwd escapes the selected project root.
 */
export function validateToolSandbox(
  payload: Pick<ToolPayload, "cwd">,
  directory: string
): ToolResult | undefined {
  const normalizedCwd = path.resolve(payload.cwd);
  const normalizedDir = path.resolve(directory);
  if (
    normalizedCwd !== normalizedDir &&
    !normalizedCwd.startsWith(normalizedDir + path.sep)
  ) {
    return {
      ok: false,
      error: `Blocked: cwd "${payload.cwd}" is outside project directory "${directory}"`,
    };
  }

  return;
}

/**
 * Format thrown tool errors into user-facing strings.
 */
export function formatToolError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.format();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
