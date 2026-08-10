export type DirEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
};

export type ExistingProjectData = {
  orgSlug: string;
  projectSlug: string;
  projectId: string;
  dsn: string;
  url: string;
  platform?: string;
};

export type WizardOptions = {
  directory: string;
  yes: boolean;
  dryRun: boolean;
  features?: string[];
  team?: string;
  org?: string;
  project?: string;
  /** Pre-selected app name for monorepo runs. When set, skips the interactive
   * app-selection prompt and uses this value directly. Required when `--yes`
   * is passed against a monorepo with more than one detected app. */
  app?: string;
  /**
   * Force the non-Ink fallback (`LoggingUI`). Mapped from
   * `--no-tui`. Acts as an escape hatch when the Ink TUI
   * misbehaves; in an interactive run this effectively disables
   * prompts (any prompt path will throw a `LoggingUIPromptError`),
   * so users hitting this flag should also pass `--yes` or set
   * every choice via flags.
   */
  forceLegacyUi?: boolean;
};

export type ResolvedInitContext = {
  directory: string;
  yes: boolean;
  dryRun: boolean;
  features?: string[];
  org: string;
  /**
   * Resolved team slug for init operations.
   * Omitted when init defers empty-org auto-creation until project creation.
   */
  team?: string;
  /**
   * True only when `team` was supplied via the `--team` CLI flag.
   * False/absent when the team was auto-selected by preflight.
   * Used by project creation tools to decide whether to suppress the
   * org-scoped fallback on 403 (only suppress for explicitly named teams).
   */
  isExplicitTeam?: boolean;
  project?: string;
  /** Pre-selected app name for monorepo runs. Passed through from `--app`. */
  app?: string;
  authToken?: string;
  existingProject?: ExistingProjectData;
};

export type InteractiveContext = Pick<
  ResolvedInitContext,
  "yes" | "dryRun" | "app"
>;

// Tool suspend payloads
export type ToolPayload =
  | ListDirPayload
  | ReadFilesPayload
  | FileExistsBatchPayload
  | RunCommandsPayload
  | ApplyPatchsetPayload
  | GrepPayload
  | GlobPayload
  | CreateSentryProjectPayload
  | EnsureSentryProjectPayload
  | DetectSentryPayload;

export type ToolOperation = ToolPayload["operation"];

export type ListDirPayload = {
  type: "tool";
  operation: "list-dir";
  cwd: string;
  params: {
    path: string;
    recursive?: boolean;
    maxDepth?: number;
    maxEntries?: number;
  };
};

export type ReadFilesPayload = {
  type: "tool";
  operation: "read-files";
  cwd: string;
  params: {
    paths: string[];
    maxBytes?: number;
  };
};

export type FileExistsBatchPayload = {
  type: "tool";
  operation: "file-exists-batch";
  cwd: string;
  params: {
    paths: string[];
  };
};

export type RunCommandsPayload = {
  type: "tool";
  operation: "run-commands";
  cwd: string;
  params: {
    commands: string[];
    timeoutMs?: number;
  };
};

export type GrepSearch = {
  pattern: string;
  path?: string;
  include?: string;
  /**
   * Case-insensitive match. Default: false (case-sensitive, matching
   * `rg`'s default). A leading `(?i)` inline flag in `pattern` has
   * the same effect — callers can use either.
   *
   * No current Mastra server invocation sets this field; reserving
   * it here means the server can start sending it without a CLI
   * update. The underlying scan engine natively supports it.
   */
  caseInsensitive?: boolean;
  /**
   * Multiline mode: when true (default), `^` and `$` match at line
   * boundaries within the file — grep/rg semantics. When false, they
   * anchor to the buffer start/end — strict JS `RegExp` semantics.
   * Rarely needs to be set.
   */
  multiline?: boolean;
};

export type GrepPayload = {
  type: "tool";
  operation: "grep";
  cwd: string;
  params: {
    searches: GrepSearch[];
    maxResultsPerSearch?: number;
  };
};

export type GlobPayload = {
  type: "tool";
  operation: "glob";
  cwd: string;
  params: {
    patterns: string[];
    path?: string;
    maxResults?: number;
  };
};

export type PatchEdit = {
  oldString: string;
  newString: string;
};

export type ApplyPatchsetPatch =
  | { path: string; action: "create"; patch: string }
  | { path: string; action: "modify"; edits: PatchEdit[] }
  | { path: string; action: "delete"; patch?: string };

export type ApplyPatchsetPayload = {
  type: "tool";
  operation: "apply-patchset";
  cwd: string;
  params: {
    patches: ApplyPatchsetPatch[];
  };
};

export type CreateSentryProjectPayload = {
  type: "tool";
  operation: "create-sentry-project";
  /** Human-readable spinner hint from the server (≤ 120 chars, sensitive values redacted). */
  detail?: string;
  cwd: string;
  params: {
    name: string;
    platform: string;
  };
};

export type EnsureSentryProjectPayload = {
  type: "tool";
  operation: "ensure-sentry-project";
  /** Human-readable spinner hint from the server (≤ 120 chars, sensitive values redacted). */
  detail?: string;
  cwd: string;
  params: {
    name: string;
    platform: string;
  };
};

export type DetectSentryPayload = {
  type: "tool";
  operation: "detect-sentry";
  detail?: string;
  cwd: string;
  params: Record<string, never>;
};

export type ToolResult = {
  ok: boolean;
  error?: string;
  message?: string;
  data?: unknown;
};

// Wizard output
export type WizardOutput = {
  platform?: string;
  projectDir?: string;
  features?: string[];
  commands?: string[];
  changedFiles?: Array<{ action: string; path: string }>;
  warnings?: string[];
  exitCode?: number;
  docsUrl?: string;
  sentryProjectUrl?: string;
  message?: string;
  featureBlurbs?: Array<{ feature: string; blurb: string }>;
};

// Interactive payloads
export type InteractivePayload =
  | SelectPayload
  | MultiSelectPayload
  | ConfirmPayload;

export type SelectPayload = {
  type: "interactive";
  kind: "select";
  prompt: string;
  options?: string[];
  apps?: Array<{ name: string; path: string; framework?: string }>;
};

export type MultiSelectPayload = {
  type: "interactive";
  kind: "multi-select";
  prompt: string;
  availableFeatures?: string[];
  options?: string[];
};

export type ConfirmPayload = {
  type: "interactive";
  kind: "confirm";
  prompt: string;
};

export type SuspendPayload = ToolPayload | InteractivePayload;

export type WorkflowRunResult = {
  status: "suspended" | "success" | "failed";
  suspended?: string[][];
  activeStepsPath?: Record<string, unknown>;
  steps?: Record<
    string,
    {
      status?:
        | "success"
        | "failed"
        | "suspended"
        | "running"
        | "waiting"
        | "paused";
      suspendPayload?: unknown;
    }
  >;
  suspendPayload?: unknown;
  result?: WizardOutput;
  error?: string;
};
