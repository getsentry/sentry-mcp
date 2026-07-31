/**
 * Wizard UI State Store
 *
 * Tiny external store that bridges the imperative `WizardUI` methods
 * to React's render loop. The `InkUI` class mutates this store
 * (intro text, log entries, spinner state, active prompt) and the
 * React `App` subscribes via `useSyncExternalStore`.
 *
 * This avoids the alternative of holding component state inside the
 * `App` itself and exposing setter callbacks back to the class — which
 * would create a chicken-and-egg between mounting the React tree and
 * binding the WizardUI instance.
 *
 * The store is intentionally minimal: snapshots are plain immutable
 * objects so React's default `Object.is` reference check is enough
 * to detect changes.
 */

import {
  CANONICAL_STEP_ORDER,
  CHECKLIST_VISIBLE_STEPS,
  shortStepLabel,
} from "../clack-utils.js";
import type {
  SpinnerExitCode,
  WelcomeOptions,
  WizardSummary,
} from "./types.js";

export type LogSeverity = "info" | "warn" | "error" | "success" | "message";

export type LogEntry = {
  /** Stable id used as React key. Monotonic per store instance. */
  id: number;
  severity: LogSeverity;
  text: string;
};

export type SpinnerState = {
  active: boolean;
  /** The spinner frame index. Bumped by the renderer's interval. */
  frame: number;
  message: string;
};

/**
 * One entry tracking a file the wizard has read from disk during the
 * session. Status transitions `reading` → `analyzed` once the tool
 * returns. Surfaced by the inline file-read status line and sidebar
 * tree in the Ink app (see `FileReadStatus` and `FilesPanel` in
 * `ink-app.tsx`).
 */
export type FileReadEntry = {
  path: string;
  status: "reading" | "analyzed";
};

/**
 * Status of a single workflow step in the sidebar progress checklist.
 *
 *   - `pending`     — runner hasn't reached this step yet.
 *   - `in_progress` — runner is suspended on this step.
 *   - `completed`   — runner has resumed past this step.
 *   - `skipped`     — workflow's branching bypassed this step
 *                     (back-filled implicitly when a later step starts).
 *   - `failed`      — runner aborted while this step was active.
 */
export type StepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "skipped"
  | "failed";

/** One row in the sidebar progress checklist. */
export type StepEntry = {
  /** Mastra step id (e.g. `"discover-context"`). */
  id: string;
  /** Sidebar-friendly short label (already abbreviated). */
  label: string;
  status: StepStatus;
};

/** Generic option shape passed to mounted prompts. */
export type PromptOption = {
  value: string;
  label: string;
  hint?: string;
};

/**
 * Discriminated union for the currently-mounted prompt. `null` when no
 * prompt is active. Each variant carries the data the matching React
 * component needs plus a `resolve` callback that the component invokes
 * with the user's choice (or with `null` to indicate cancellation —
 * the bridge in `ink-ui.ts` translates `null` to the shared
 * `CANCELLED` sentinel before handing the value back to the wizard).
 */
export type ActivePrompt =
  | {
      kind: "select";
      message: string;
      options: PromptOption[];
      initialIndex: number;
      resolve: (value: string | null) => void;
    }
  | {
      kind: "multiselect";
      message: string;
      options: PromptOption[];
      initialSelected: string[];
      required: boolean;
      resolve: (values: string[] | null) => void;
    }
  | {
      kind: "confirm";
      message: string;
      initialValue: boolean;
      resolve: (value: boolean | null) => void;
    }
  | {
      kind: "welcome";
      options: WelcomeOptions;
      resolve: (value: "continue" | null) => void;
    };

/** Non-blocking overlay shown on top of the normal content. */
export type Overlay = {
  kind: "health";
  message: string;
  retryCount: number;
} | null;

/** Outro screen state — overrides normal tab content when set. */
export type OutroState =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string; errors: string[] }
  | { kind: "cancel"; message: string }
  | null;

/** Learn card progressive reveal state. */
export type LearnState = {
  blockIndex: number;
  lineIndex: number;
  complete: boolean;
};

export type WizardLayout = "intro" | "workflow";

export type WizardSnapshot = {
  /** Top-level layout: centered intro/preflight or full workflow shell. */
  layout: WizardLayout;
  /** CLI version displayed in the persistent Ink footer banner. */
  cliVersion: string | null;
  bannerRows: { content: string; color: string }[];
  logs: LogEntry[];
  spinner: SpinnerState;
  prompt: ActivePrompt | null;
  /** Index of the currently-displayed Sentry tip in the sidebar. */
  tipIndex: number;
  /** Final structured summary, rendered after the workflow completes. */
  summary: WizardSummary | null;
  /**
   * Persistent list of every file the wizard has read from disk. Each
   * entry carries a status that transitions `reading` → `analyzed` as
   * the workflow progresses. Surfaced by the inline file-read status
   * line in the Ink UI so the user can see what context the wizard
   * inspected — without the previous spinner-message approach, which
   * flashed each batch for half a second before the next tool
   * overwrote it.
   */
  filesRead: FileReadEntry[];
  /**
   * Workflow step progress checklist. Pre-populated from
   * `CHECKLIST_VISIBLE_STEPS` with every entry as `pending`; the
   * runner advertises status changes via `WizardUI.setStep()` and
   * the store updates the matching entry in place. Steps not present
   * in the visible-step allowlist (e.g. `select-target-app`,
   * `resolve-dir`) are silently ignored so the sidebar stays compact.
   */
  steps: StepEntry[];
  /**
   * Cancellation callback wired up by the bridge (`InkUI`) so the
   * App's top-level Ctrl+C catcher can route through the same
   * teardown path as SIGINT and prompt cancellation. `undefined`
   * after teardown to short-circuit any stale events Ink might
   * dispatch on the way out.
   *
   * Snapshotted on the store rather than passed via React props so
   * the App doesn't have to thread a callback through every layer.
   */
  requestCancel: (() => void) | undefined;
  /**
   * Rolling status messages displayed in the collapsible status bar.
   * The most recent message is shown with a diamond icon; older
   * messages show as history with a thin separator. The bridge
   * appends to this list whenever the spinner message changes to
   * keep a visible trail of what the wizard is doing.
   */
  statusMessages: string[];
  /** Whether the status bar is expanded (shows more history). */
  statusExpanded: boolean;
  /** Non-blocking overlay rendered on top of tab content. */
  overlay: Overlay;
  /** When set, overrides the normal tab content with an outro screen. */
  outroState: OutroState;
  /** Learn sequence progressive reveal state. */
  learnState: LearnState;
};

export type Listener = () => void;

/**
 * Minimal external store with the React 18+ `useSyncExternalStore`
 * subscription contract.
 */
export class WizardStore {
  private snapshot: WizardSnapshot;
  private nextLogId = 1;
  private readonly listeners = new Set<Listener>();

  constructor(initial: Partial<WizardSnapshot> = {}) {
    this.snapshot = {
      layout: initial.layout ?? "workflow",
      cliVersion: initial.cliVersion ?? null,
      bannerRows: initial.bannerRows ?? [],
      logs: initial.logs ?? [],
      spinner: initial.spinner ?? { active: false, frame: 0, message: "" },
      prompt: initial.prompt ?? null,
      tipIndex: initial.tipIndex ?? 0,
      summary: initial.summary ?? null,
      filesRead: initial.filesRead ?? [],
      steps:
        initial.steps ??
        CHECKLIST_VISIBLE_STEPS.map((id) => ({
          id,
          label: shortStepLabel(id),
          status: "pending" as StepStatus,
        })),
      requestCancel: initial.requestCancel,
      statusMessages: initial.statusMessages ?? [],
      statusExpanded: initial.statusExpanded ?? false,
      overlay: initial.overlay ?? null,
      outroState: initial.outroState ?? null,
      learnState: initial.learnState ?? {
        blockIndex: 0,
        lineIndex: 0,
        complete: false,
      },
    };
  }

  getSnapshot = (): WizardSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // ── Mutators ──────────────────────────────────────────────────────

  setBanner(rows: { content: string; color: string }[]): void {
    this.update({ bannerRows: rows });
  }

  setLayout(layout: WizardLayout): void {
    if (this.snapshot.layout === layout) {
      return;
    }
    this.update({ layout });
  }

  appendLog(severity: LogSeverity, text: string): LogEntry {
    const entry: LogEntry = {
      id: this.nextLogId,
      severity,
      text,
    };
    this.nextLogId += 1;
    this.update({ logs: [...this.snapshot.logs, entry] });
    return entry;
  }

  startSpinner(message: string): void {
    this.update({
      spinner: { active: true, frame: 0, message },
    });
  }

  setSpinnerMessage(message: string): void {
    if (!this.snapshot.spinner.active) {
      return;
    }
    this.update({
      spinner: { ...this.snapshot.spinner, message },
    });
  }

  tickSpinner(): void {
    if (!this.snapshot.spinner.active) {
      return;
    }
    this.update({
      spinner: {
        ...this.snapshot.spinner,
        frame: this.snapshot.spinner.frame + 1,
      },
    });
  }

  stopSpinner(): void {
    this.update({
      spinner: { active: false, frame: 0, message: "" },
    });
  }

  setPrompt(prompt: ActivePrompt | null): void {
    this.update({ prompt });
  }

  setTipIndex(index: number): void {
    if (this.snapshot.tipIndex === index) {
      return;
    }
    this.update({ tipIndex: index });
  }

  setSummary(summary: WizardSummary | null): void {
    this.update({ summary });
  }

  /**
   * Register (or clear) the cooperative cancel callback. The Ink App
   * subscribes to the snapshot and calls this from its top-level
   * Ctrl+C `useInput` handler when no prompt is mounted (typical
   * spinner / network-call window). Set to `undefined` on teardown
   * so a stale event from Ink's render pipeline doesn't re-enter
   * cancellation.
   */
  setRequestCancel(callback: (() => void) | undefined): void {
    if (this.snapshot.requestCancel === callback) {
      return;
    }
    this.update({ requestCancel: callback });
  }

  /**
   * Record that the wizard is currently reading a batch of files.
   * Existing entries (read in earlier batches) keep their status so
   * the file-read status line preserves history; new entries land
   * with status `reading` and flip to `analyzed` via
   * `markFilesAnalyzed()` when the tool returns.
   */
  recordFilesReading(paths: string[]): void {
    if (paths.length === 0) {
      return;
    }
    const byPath = new Map(
      this.snapshot.filesRead.map((entry) => [entry.path, entry])
    );
    for (const path of paths) {
      const existing = byPath.get(path);
      // Don't downgrade an already-analyzed entry back to `reading`
      // if the same file is read again later in the run.
      if (!existing || existing.status === "reading") {
        byPath.set(path, { path, status: "reading" });
      }
    }
    this.update({ filesRead: [...byPath.values()] });
  }

  /**
   * Update the status of a workflow step in the sidebar progress
   * checklist.
   *
   * Behavior:
   *
   *   - If `id` is not in {@link CHECKLIST_VISIBLE_STEPS}, the call is
   *     a no-op — keeps the sidebar compact for plumbing-only steps.
   *
   *   - When transitioning a step to `in_progress`, any earlier
   *     `pending` step (per {@link CANONICAL_STEP_ORDER}) is
   *     back-filled to `skipped`. The workflow can only move forward,
   *     so an earlier pending step that the runner walked past was
   *     bypassed by an `if`-branch.
   *
   *   - Re-entering an already-`in_progress` step is a no-op (a step
   *     can suspend multiple times — read-files, analyze, etc. — and
   *     the checklist should only flip on the first entry).
   *
   *   - `completed` / `failed` always overwrite. `skipped` only
   *     applies if the step is currently `pending` (avoid clobbering
   *     a completed step).
   */
  setStepStatus(id: string, status: StepStatus): void {
    const canonicalIndex = CANONICAL_STEP_ORDER.indexOf(id);

    let nextSteps = this.snapshot.steps;
    if (status === "in_progress" && canonicalIndex >= 0) {
      nextSteps = backfillSkippedSteps(nextSteps, canonicalIndex);
    }
    if (CHECKLIST_VISIBLE_STEPS.includes(id)) {
      nextSteps = applyStepStatus(nextSteps, id, status);
    }

    if (nextSteps !== this.snapshot.steps) {
      this.update({ steps: nextSteps });
    }
  }

  /**
   * Flip the matching entries in `filesRead` from `reading` to
   * `analyzed`. Paths not present in the store are added as
   * pre-analyzed (defensive — covers tools that return file lists
   * without a prior `recordFilesReading` call).
   */
  markFilesAnalyzed(paths: string[]): void {
    if (paths.length === 0) {
      return;
    }
    const byPath = new Map(
      this.snapshot.filesRead.map((entry) => [entry.path, entry])
    );
    for (const path of paths) {
      byPath.set(path, { path, status: "analyzed" });
    }
    this.update({ filesRead: [...byPath.values()] });
  }

  appendStatus(message: string): void {
    if (!message) {
      return;
    }
    this.update({
      statusMessages: [...this.snapshot.statusMessages, message],
    });
  }

  toggleStatusExpanded(): void {
    this.update({ statusExpanded: !this.snapshot.statusExpanded });
  }

  setOverlay(overlay: Overlay): void {
    this.update({ overlay });
  }

  clearOverlay(): void {
    if (this.snapshot.overlay === null) {
      return;
    }
    this.update({ overlay: null });
  }

  setOutro(state: OutroState): void {
    this.update({ outroState: state });
  }

  advanceLearnLine(): void {
    const { learnState } = this.snapshot;
    if (learnState.complete) {
      return;
    }
    this.update({
      learnState: { ...learnState, lineIndex: learnState.lineIndex + 1 },
    });
  }

  advanceLearnBlock(): void {
    const { learnState } = this.snapshot;
    if (learnState.complete) {
      return;
    }
    this.update({
      learnState: {
        blockIndex: learnState.blockIndex + 1,
        lineIndex: 0,
        complete: false,
      },
    });
  }

  setLearnComplete(): void {
    if (this.snapshot.learnState.complete) {
      return;
    }
    this.update({
      learnState: { ...this.snapshot.learnState, complete: true },
    });
  }

  // ── Internal ──────────────────────────────────────────────────────

  /**
   * Replace the snapshot (immutable update), then notify all
   * subscribers. Listeners are called synchronously — fine for the
   * single-React-root setup the wizard uses.
   */
  private update(patch: Partial<WizardSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  // Severity-to-prefix mapping kept here (alongside the entry type) so
  // both the React renderer and the post-dispose summary report agree
  // on the format.
  static prefixFor(severity: LogSeverity, code?: SpinnerExitCode): string {
    if (severity === "message") {
      return " ";
    }
    if (severity === "info") {
      return "●";
    }
    if (severity === "warn") {
      return "▲";
    }
    if (severity === "error") {
      return "✖";
    }
    if (severity === "success") {
      return "✔";
    }
    // Spinner stop codes get mapped through this same function for
    // transcript replay; default to the success glyph.
    if (code === 1) {
      return "✖";
    }
    if (code === 2) {
      return "▲";
    }
    return "✔";
  }
}

/**
 * Back-fill any `pending` step whose canonical position is earlier
 * than `startedIndex` to `skipped`. The workflow can only move
 * forward, so a still-pending earlier step that the runner walked
 * past was bypassed by an `if`-branch.
 *
 * Returns the original array reference if nothing changed — the
 * store relies on this to skip subscriber notifications for no-op
 * mutations.
 */
function backfillSkippedSteps(
  steps: StepEntry[],
  startedIndex: number
): StepEntry[] {
  let changed = false;
  const candidate = steps.map((entry) => {
    if (entry.status !== "pending") {
      return entry;
    }
    const entryIndex = CANONICAL_STEP_ORDER.indexOf(entry.id);
    if (entryIndex >= 0 && entryIndex < startedIndex) {
      changed = true;
      return { ...entry, status: "skipped" as StepStatus };
    }
    return entry;
  });
  return changed ? candidate : steps;
}

/**
 * Apply a status update to the matching step entry, with idempotency
 * and clobber-protection rules:
 *
 *   - Re-entering an already-`in_progress` step is a no-op (the same
 *     step can suspend multiple times).
 *   - Explicit `skipped` only wins when the row is currently
 *     `pending` — protects against accidentally clobbering a
 *     completed step.
 *   - `completed` / `failed` always overwrite.
 *
 * Returns the original array reference when the update is a no-op
 * so subscribers aren't notified.
 */
function applyStepStatus(
  steps: StepEntry[],
  id: string,
  status: StepStatus
): StepEntry[] {
  const targetIndex = steps.findIndex((entry) => entry.id === id);
  if (targetIndex === -1) {
    return steps;
  }
  const current = steps[targetIndex];
  if (!current) {
    return steps;
  }
  if (status === current.status) {
    return steps;
  }
  if (status === "skipped" && current.status !== "pending") {
    return steps;
  }
  const updated = [...steps];
  updated[targetIndex] = { ...current, status };
  return updated;
}
