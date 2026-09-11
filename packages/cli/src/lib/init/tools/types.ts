import type { ChooseProjectTeam } from "../../resolve-team.js";
import type {
  ResolvedInitContext,
  ToolOperation,
  ToolPayload,
  ToolResult,
} from "../types.js";

/** Client-side context shared by every init tool. */
export type ToolContext = ResolvedInitContext;

/** Narrow interactive capabilities supplied by the local wizard runner. */
export type ToolCapabilities = {
  chooseTeam?: ChooseProjectTeam;
};

export type ProjectCreationToolOperation =
  | "create-sentry-project"
  | "ensure-sentry-project";

/** Extra local capabilities visible only to project-creation tools. */
export type ProjectCreationToolContext = ToolContext & ToolCapabilities;

type ToolContextFor<TOperation extends ToolOperation> =
  TOperation extends ProjectCreationToolOperation
    ? ProjectCreationToolContext
    : ToolContext;

/**
 * A single init tool implementation plus its user-facing spinner copy.
 */
export type InitToolDefinition<TOperation extends ToolOperation> = {
  /** Stable operation name used in suspend payloads. */
  operation: TOperation;
  /** Build a short spinner message for the current payload. */
  describe: (
    payload: Extract<ToolPayload, { operation: TOperation }>
  ) => string;
  /** Execute the tool and return a resumable payload result. */
  execute: (
    payload: Extract<ToolPayload, { operation: TOperation }>,
    context: ToolContextFor<TOperation>
  ) => Promise<ToolResult>;
};

/**
 * Union of all concrete init tool definitions.
 */
export type AnyInitToolDefinition = {
  [Operation in ToolOperation]: InitToolDefinition<Operation>;
}[ToolOperation];
