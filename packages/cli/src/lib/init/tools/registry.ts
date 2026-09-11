import { ApiError } from "../../errors.js";
import { WizardCancelledError } from "../clack-utils.js";
import type { ToolOperation, ToolPayload, ToolResult } from "../types.js";
import { agentCheckpointTool } from "./agent-checkpoint.js";
import { applyPatchsetTool } from "./apply-patchset.js";
import {
  createSentryProjectTool,
  ensureSentryProjectTool,
} from "./create-sentry-project.js";
import { detectSentryTool } from "./detect-sentry.js";
import { fileExistsBatchTool } from "./file-exists-batch.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { listDirTool } from "./list-dir.js";
import { readFilesTool } from "./read-files.js";
import { runCommandsTool } from "./run-commands.js";
import { formatToolError, validateToolSandbox } from "./shared.js";
import type {
  AnyInitToolDefinition,
  ToolCapabilities,
  ToolContext,
} from "./types.js";

const PROJECT_CREATION_OPERATIONS = new Set<ToolOperation>([
  "create-sentry-project",
  "ensure-sentry-project",
]);

const toolDefinitions = [
  agentCheckpointTool,
  listDirTool,
  readFilesTool,
  fileExistsBatchTool,
  runCommandsTool,
  applyPatchsetTool,
  grepTool,
  globTool,
  createSentryProjectTool,
  ensureSentryProjectTool,
  detectSentryTool,
] as const satisfies readonly AnyInitToolDefinition[];

const toolRegistry = new Map<ToolOperation, AnyInitToolDefinition>(
  toolDefinitions.map((tool) => [tool.operation, tool] as const)
);

/** Sentry API operations never inspect or mutate the local filesystem. */
const CWD_INDEPENDENT_OPERATIONS = new Set<ToolOperation>([
  "agent-checkpoint",
  "create-sentry-project",
  "ensure-sentry-project",
]);

/**
 * Build the spinner message for a suspended tool request.
 */
export function describeTool(payload: ToolPayload): string {
  const tool = toolRegistry.get(payload.operation);
  return tool ? tool.describe(payload as never) : `${payload.operation}...`;
}

/**
 * Execute a suspended tool request against the local filesystem/API context.
 */
export async function executeTool(
  payload: ToolPayload,
  context: ToolContext,
  capabilities: ToolCapabilities = {}
): Promise<ToolResult> {
  const tool = toolRegistry.get(payload.operation);
  if (!tool) {
    return {
      ok: false,
      error: `Unknown operation: ${(payload as { operation?: string }).operation ?? "unknown"}`,
    };
  }

  let sandboxedPayload = payload;
  if (!CWD_INDEPENDENT_OPERATIONS.has(payload.operation)) {
    const sandbox = validateToolSandbox(payload, context.directory);
    if ("ok" in sandbox) {
      return sandbox;
    }
    sandboxedPayload = { ...payload, cwd: sandbox.cwd } as ToolPayload;
  }

  try {
    const executionContext = PROJECT_CREATION_OPERATIONS.has(payload.operation)
      ? { ...context, chooseTeam: capabilities.chooseTeam }
      : context;
    return await tool.execute(
      sandboxedPayload as never,
      executionContext as never
    );
  } catch (error) {
    if (error instanceof WizardCancelledError) {
      throw error;
    }
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      throw error;
    }
    return { ok: false, error: formatToolError(error) };
  }
}
