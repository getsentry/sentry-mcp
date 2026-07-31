import fs from "node:fs";
import path from "node:path";
import { safeReadFile } from "../../safe-read.js";
import { replace } from "../replacers.js";
import type {
  ApplyPatchsetPatch,
  ApplyPatchsetPayload,
  ToolResult,
} from "../types.js";
import { safePath } from "./shared.js";
import type { InitToolDefinition, ToolContext } from "./types.js";

/** Pattern matching empty or placeholder SENTRY_AUTH_TOKEN values in env files. */
const EMPTY_AUTH_TOKEN_RE =
  /^(SENTRY_AUTH_TOKEN[ \t]*=[ \t]*)(?:['"]?[ \t]*['"]?)?[ \t]*$/m;
const PATH_SEGMENT_RE = /[/\\]/u;
const WINDOWS_DRIVE_RE = /^[A-Za-z]:/;

const VALID_PATCH_ACTIONS = new Set(["create", "modify", "delete"]);

function validatePatchPath(filePath: unknown): string | undefined {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return "Invalid patch path: expected a non-empty project-relative path";
  }
  if (filePath.includes("\\")) {
    return `Invalid patch path "${filePath}": use project-relative POSIX paths`;
  }
  if (WINDOWS_DRIVE_RE.test(filePath) || path.posix.isAbsolute(filePath)) {
    return `Invalid patch path "${filePath}": absolute paths are not allowed`;
  }
  const segments = filePath.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    return `Invalid patch path "${filePath}": path segments must not be empty, "." or ".."`;
  }
  return;
}

function validatePatch(patch: unknown, cwd: string): ToolResult | undefined {
  if (!patch || typeof patch !== "object") {
    return {
      ok: false,
      error:
        "Invalid patch path: expected a patch object with a project-relative path",
    };
  }

  const candidate = patch as { action?: unknown; path?: unknown };
  const pathError = validatePatchPath(candidate.path);
  if (pathError) {
    return { ok: false, error: pathError };
  }
  const patchPath = candidate.path as string;
  try {
    safePath(cwd, patchPath);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (
    typeof candidate.action !== "string" ||
    !VALID_PATCH_ACTIONS.has(candidate.action)
  ) {
    return {
      ok: false,
      error: `Unknown patch action: "${String(candidate.action)}" for path "${patchPath}"`,
    };
  }
  return;
}

/**
 * Apply a batch of file creates, modifications, and deletes.
 */
export async function applyPatchset(
  payload: ApplyPatchsetPayload,
  context: Pick<ToolContext, "dryRun" | "authToken">
): Promise<ToolResult> {
  if (context.dryRun) {
    return applyPatchsetDryRun(payload);
  }

  for (const patch of payload.params.patches) {
    const validationError = validatePatch(patch, payload.cwd);
    if (validationError) {
      return validationError;
    }
  }

  const applied: Array<{ path: string; action: string }> = [];

  for (const patch of payload.params.patches) {
    const absPath = safePath(payload.cwd, patch.path);

    if (patch.action === "modify") {
      try {
        await fs.promises.access(absPath);
      } catch {
        return {
          ok: false,
          error: `Cannot modify "${patch.path}": file does not exist`,
          data: { applied },
        };
      }
    }

    await applySinglePatch(absPath, patch, context.authToken);
    applied.push({ path: patch.path, action: patch.action });
  }

  return { ok: true, data: { applied } };
}

function applyPatchsetDryRun(payload: ApplyPatchsetPayload): ToolResult {
  const applied: Array<{ path: string; action: string }> = [];

  for (const patch of payload.params.patches) {
    const validationError = validatePatch(patch, payload.cwd);
    if (validationError) {
      return validationError;
    }
    applied.push({ path: patch.path, action: patch.action });
  }

  return { ok: true, data: { applied } };
}

async function applySinglePatch(
  absPath: string,
  patch: ApplyPatchsetPatch,
  authToken?: string
): Promise<void> {
  switch (patch.action) {
    case "create": {
      await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
      const content = resolvePatchContent(
        patch as ApplyPatchsetPatch & { patch: string },
        authToken
      );
      await fs.promises.writeFile(absPath, content, "utf-8");
      break;
    }
    case "modify": {
      const content = await applyEdits(absPath, patch.path, patch.edits);
      await fs.promises.writeFile(absPath, content, "utf-8");
      break;
    }
    case "delete": {
      try {
        await fs.promises.unlink(absPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
      break;
    }
    default:
      break;
  }
}

function resolvePatchContent(
  patch: { path: string; patch: string },
  authToken?: string
): string {
  let content = patch.path.endsWith(".json")
    ? prettyPrintJson(patch.patch)
    : patch.patch;

  if (authToken && isEnvFile(patch.path) && EMPTY_AUTH_TOKEN_RE.test(content)) {
    content = content.replace(
      EMPTY_AUTH_TOKEN_RE,
      (_, prefix) => `${prefix}${authToken}`
    );
  }

  return content;
}

function prettyPrintJson(content: string): string {
  try {
    return `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
  } catch {
    return content;
  }
}

function isEnvFile(filePath: string): boolean {
  const name = filePath.split(PATH_SEGMENT_RE).at(-1) ?? "";
  return name === ".env" || name.startsWith(".env.");
}

async function applyEdits(
  absPath: string,
  filePath: string,
  edits: Array<{ oldString: string; newString: string }>
): Promise<string> {
  const initialContent = await safeReadFile(absPath, "apply-patchset.read");
  if (initialContent === null) {
    // `applyPatchset`'s earlier `access()` call only verifies
    // existence — it follows symlinks and succeeds on FIFOs/sockets,
    // so this branch is the primary guard against non-regular files
    // (FIFO, socket, symlink → FIFO) that would otherwise hang
    // `readFile` indefinitely, plus any other expected I/O failure
    // (permission, transient read error) routed through
    // `safeReadFile`.
    throw new Error(
      `Cannot read "${filePath}": not a regular file or read failed`
    );
  }
  let content = initialContent;

  for (let i = 0; i < edits.length; i += 1) {
    const edit = edits[i];
    if (!edit) {
      continue;
    }
    try {
      content = replace(content, edit.oldString, edit.newString);
    } catch (error) {
      throw new Error(
        `Edit #${i + 1} failed on "${filePath}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return content;
}

/**
 * Tool definition for file patch application.
 */
export const applyPatchsetTool: InitToolDefinition<"apply-patchset"> = {
  operation: "apply-patchset",
  describe: (payload) => {
    const [first] = payload.params.patches;
    if (payload.params.patches.length === 1 && first) {
      const verb = patchActionVerb(first.action);
      const fileName = first.path.split(PATH_SEGMENT_RE).at(-1) ?? first.path;
      return `${verb} \`${fileName}\`...`;
    }
    return `Applying ${payload.params.patches.length} file changes...`;
  },
  execute: applyPatchset,
};

function patchActionVerb(action: ApplyPatchsetPatch["action"]): string {
  switch (action) {
    case "create":
      return "Creating";
    case "modify":
      return "Modifying";
    case "delete":
      return "Deleting";
    default:
      return "Updating";
  }
}
