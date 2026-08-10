/**
 * Wizard Utilities
 *
 * Shared cancellation helpers and feature labels for the init wizard.
 *
 * The file name is preserved (vs. renaming to `wizard-utils.ts`) to
 * keep the diff in PR 4 focused on the clack removal — the next
 * cleanup PR can do the rename. Despite the historical name nothing
 * here references clack any more.
 */

import { isCancelled } from "./ui/types.js";

export class WizardCancelledError extends Error {
  constructor() {
    super("Setup cancelled.");
    this.name = "WizardCancelledError";
  }
}

/**
 * Coerce a possibly-cancelled prompt result into the resolved value, or
 * throw `WizardCancelledError` on cancellation.
 *
 * The return type uses `Exclude<T, symbol>` so callers passing a union
 * that includes a symbol member (e.g. `string[] | typeof CANCELLED`)
 * receive the narrowed non-symbol type back — TypeScript otherwise
 * widens `T` to the full union and refuses to call array methods on it.
 */
export function abortIfCancelled<T>(value: T): Exclude<T, symbol> {
  if (isCancelled(value)) {
    throw new WizardCancelledError();
  }
  return value as Exclude<T, symbol>;
}

const FEATURE_INFO: Record<string, { label: string; hint: string }> = {
  errorMonitoring: {
    label: "Error Monitoring",
    hint: "Group exceptions into issues with context",
  },
  performanceMonitoring: {
    label: "Tracing",
    hint: "See request paths, spans, and bottlenecks",
  },
  sessionReplay: {
    label: "Session Replay",
    hint: "Replay sessions linked to errors",
  },
  profiling: {
    label: "Profiling",
    hint: "Find CPU-heavy functions in production",
  },
  logs: { label: "Logging", hint: "Search logs beside errors and traces" },
  metrics: { label: "Metrics", hint: "Track custom measurements over time" },
  sourceMaps: {
    label: "Source Maps",
    hint: "Turn minified stacks into your source",
  },
  crons: {
    label: "Crons",
    hint: "Alert on failed or missed scheduled jobs",
  },
  aiMonitoring: {
    label: "AI Monitoring",
    hint: "Track AI calls, latency, cost, and failures",
  },
  userFeedback: {
    label: "User Feedback",
    hint: "Collect user reports with issue context",
  },
  reactFeatures: {
    label: "React Features",
    hint: "Add React-specific context and integrations",
  },
};

export function featureLabel(id: string): string {
  return FEATURE_INFO[id]?.label ?? id;
}

export function featureHint(id: string): string | undefined {
  return FEATURE_INFO[id]?.hint;
}

const FEATURE_DISPLAY_ORDER = [
  "errorMonitoring",
  "sessionReplay",
  "performanceMonitoring",
  "logs",
  "metrics",
  "profiling",
  "sourceMaps",
  "crons",
  "aiMonitoring",
  "userFeedback",
  "reactFeatures",
];

/** Sort features into canonical display order for the multi-select prompt. */
export function sortFeatures(features: string[]): string[] {
  return features.slice().sort((a, b) => {
    const ai = FEATURE_DISPLAY_ORDER.indexOf(a);
    const bi = FEATURE_DISPLAY_ORDER.indexOf(b);
    return (
      (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) -
      (bi === -1 ? Number.MAX_SAFE_INTEGER : bi)
    );
  });
}

export const STEP_LABELS: Record<string, string> = {
  "discover-context": "Analyzing project structure",
  "select-target-app": "Selecting target application",
  "resolve-dir": "Resolving project directory",
  "check-existing-sentry": "Checking for existing Sentry installation",
  "detect-platform": "Detecting platform and framework",
  "ensure-sentry-project": "Setting up Sentry project",
  "select-features": "Selecting features",
  "plan-codemods": "Planning code modifications",
  "apply-codemods": "Applying code modifications and installing dependencies",
  "verify-changes": "Verifying changes",
  "open-sentry-ui": "Finishing up",
};

/**
 * Canonical execution order of the wizard's workflow steps.
 *
 * Used by the Ink sidebar's progress checklist as the static
 * pre-rendered list. The wizard advertises step transitions via
 * `WizardUI.setStep(...)`; the store back-fills any earlier
 * `pending` rows as `skipped` when a later step starts (the workflow
 * can only move forward, so a later transition implies any earlier
 * pending step was bypassed by an `if`-branch in the workflow).
 *
 * Order must match the actual Mastra workflow order or the back-fill
 * logic will mis-mark steps as skipped.
 */
export const CANONICAL_STEP_ORDER: readonly string[] = [
  "discover-context",
  "select-target-app",
  "resolve-dir",
  "check-existing-sentry",
  "detect-platform",
  "ensure-sentry-project",
  "select-features",
  "plan-codemods",
  "apply-codemods",
  "verify-changes",
  "open-sentry-ui",
];

/**
 * Subset of {@link CANONICAL_STEP_ORDER} surfaced in the progress
 * checklist. The Ink sidebar is 36 cols wide and shares vertical
 * space with the tip card and the files-read panel, so showing all
 * 11 step rows would push the files panel off-screen on shorter
 * terminals.
 *
 * The hidden steps (`select-target-app`, `resolve-dir`,
 * `check-existing-sentry`) are plumbing — users care that "Setting up
 * Sentry project" happened, not that we resolved their working
 * directory along the way. Dependency installation is part of
 * `apply-codemods`; the server removed the separate `install-deps` step in
 * getsentry/cli-init-api#140.
 */
export const CHECKLIST_VISIBLE_STEPS: readonly string[] = [
  "discover-context",
  "detect-platform",
  "ensure-sentry-project",
  "select-features",
  "plan-codemods",
  "apply-codemods",
  "verify-changes",
  "open-sentry-ui",
];

/**
 * Active-voice step descriptions shown as spinner messages while
 * each step runs. More descriptive than the sidebar labels.
 */
export const STEP_ACTIVE_LABELS: Record<string, string> = {
  "discover-context": "Scanning project structure...",
  "select-target-app": "Selecting target application...",
  "resolve-dir": "Resolving project directory...",
  "check-existing-sentry": "Checking for existing Sentry setup...",
  "detect-platform": "Detecting framework and platform...",
  "ensure-sentry-project": "Configuring Sentry project...",
  "select-features": "Preparing feature selection...",
  "plan-codemods": "Planning code changes...",
  "apply-codemods": "Applying code changes and installing dependencies...",
  "verify-changes": "Verifying setup...",
  "open-sentry-ui": "Finishing up...",
};

/**
 * Sidebar-friendly abbreviations of {@link STEP_LABELS}. The full
 * labels stay the source-of-truth for the spinner message in the main
 * column; only the 36-col sidebar checklist uses these.
 *
 * Falls back to the full label if a step isn't listed here.
 */
export const STEP_LABELS_SHORT: Record<string, string> = {
  "discover-context": "Analyzing project",
  "detect-platform": "Detecting platform",
  "ensure-sentry-project": "Setting up project",
  "select-features": "Selecting features",
  "plan-codemods": "Planning changes",
  "apply-codemods": "Applying changes + deps",
  "verify-changes": "Verifying changes",
  "open-sentry-ui": "Finishing up",
};

/** Resolve a step id to its sidebar checklist label. */
export function shortStepLabel(stepId: string): string {
  return STEP_LABELS_SHORT[stepId] ?? STEP_LABELS[stepId] ?? stepId;
}

/**
 * Rotating progress messages shown while the CLI waits on a long-running
 * server-side phase that doesn't emit intermediate suspends. The messages
 * cycle on a timer so the spinner text changes and the UI doesn't look
 * frozen.
 *
 * Only steps with known long waits need entries here. Steps that suspend
 * frequently (read-files, apply-codemods) already update the spinner via
 * the suspend payload's `detail` field.
 */
export const STEP_PROGRESS_MESSAGES: Record<string, string[]> = {
  "plan-codemods": [
    "Fetching SDK documentation...",
    "Analyzing integration requirements...",
    "Generating code modification plan...",
    "Reviewing planned changes for correctness...",
    "Finalizing integration plan...",
  ],
  "detect-platform": [
    "Scanning project files...",
    "Identifying framework and language...",
    "Analyzing project configuration...",
    "Determining SDK compatibility...",
  ],
};

/** Interval between rotating progress messages (ms). */
export const PROGRESS_ROTATE_INTERVAL_MS = 12_000;
