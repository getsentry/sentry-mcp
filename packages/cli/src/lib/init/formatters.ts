/**
 * Output Formatters
 *
 * Translate the raw workflow result into the structured `WizardSummary`
 * the UI implementations render. The previous version assembled
 * terminal-flavored markdown (color tags, an aligned key/value table,
 * a tree of changed files) and pushed it through `ui.log.message`.
 * That worked for `LoggingUI` (which calls `renderMarkdown`) but the
 * earlier TUI showed literal markup like `<yellow>~</yellow>` and
 * pipe-cells because the underlying text primitive couldn't parse
 * markdown — only strip ANSI.
 *
 * Now `formatResult` calls `ui.summary(structuredData)` and lets each
 * implementation decide how to lay it out. `formatError` still uses
 * `ui.log.*` because errors are short enough to live as plain text.
 */

import { terminalLink } from "../formatters/colors.js";
import { stripAnsi } from "../formatters/plain-detect.js";
import { featureLabel, sortFeatures } from "./clack-utils.js";
import {
  EXIT_DEPENDENCY_INSTALL_FAILED,
  EXIT_PLATFORM_NOT_DETECTED,
  EXIT_VERIFICATION_FAILED,
} from "./constants.js";
import type { WizardOutput, WorkflowRunResult } from "./types.js";
import type { WizardSummary, WizardUI } from "./ui/types.js";

/**
 * Build the structured summary handed to `ui.summary()`.
 *
 * Returns `null` when there's nothing useful to display — the caller
 * skips the summary call entirely in that case so empty panels don't
 * appear.
 */
function buildSummary(output: WizardOutput): WizardSummary | null {
  // Resolve blurbs first so the Features row can check the *resolved* length.
  // If the agent returns blurbs with wrong IDs they all drop out here, and
  // the Features row falls back to showing correctly.
  const blurbMap = new Map(
    (output.featureBlurbs ?? []).map(({ feature, blurb }) => [
      feature,
      stripAnsi(blurb),
    ])
  );
  const featureBlurbs = sortFeatures(output.features ?? [])
    .map((feature) => {
      const blurb = blurbMap.get(feature);
      return blurb ? { label: featureLabel(feature), blurb } : null;
    })
    .filter((b): b is { label: string; blurb: string } => b !== null);

  const fields: WizardSummary["fields"] = [];

  if (output.platform) {
    fields.push({ label: "Platform", value: output.platform });
  }
  if (output.projectDir) {
    fields.push({ label: "Directory", value: output.projectDir });
  }
  if (output.features?.length && !featureBlurbs.length) {
    fields.push({
      label: "Features",
      value: output.features.map(featureLabel).join(", "),
    });
  }
  if (output.commands?.length) {
    fields.push({
      label: "Commands",
      value: output.commands.join("; "),
    });
  }
  if (output.sentryProjectUrl) {
    fields.push({ label: "Project", value: output.sentryProjectUrl });
  }
  if (output.docsUrl) {
    fields.push({ label: "Docs", value: output.docsUrl });
  }

  const changedFiles = output.changedFiles ?? [];

  if (
    fields.length === 0 &&
    changedFiles.length === 0 &&
    featureBlurbs.length === 0
  ) {
    return null;
  }

  return {
    fields,
    ...(changedFiles.length > 0 ? { changedFiles } : {}),
    ...(featureBlurbs.length > 0 ? { featureBlurbs } : {}),
  };
}

export function formatResult(result: WorkflowRunResult, ui: WizardUI): void {
  const output: WizardOutput = result.result ?? {};
  const summary = buildSummary(output);

  if (summary) {
    ui.summary(summary);
  }

  if (output.warnings?.length) {
    for (const w of output.warnings) {
      ui.log.warn(w);
    }
  }

  ui.log.info("Please review the changes above before committing.");

  ui.outro("Sentry SDK installed successfully!");
  ui.feedback("success");
}

export function formatError(result: WorkflowRunResult, ui: WizardUI): void {
  const inner = result.result;
  const message =
    result.error ?? inner?.message ?? "Wizard failed with an unknown error";
  const exitCode = inner?.exitCode ?? 1;

  ui.log.error(String(message));

  if (exitCode === EXIT_PLATFORM_NOT_DETECTED) {
    ui.log.warn(
      "Hint: Could not detect your project's platform. Check that the directory contains a valid project."
    );
  } else if (exitCode === EXIT_DEPENDENCY_INSTALL_FAILED) {
    const commands = inner?.commands;
    if (commands?.length) {
      ui.log.warn(
        `You can install dependencies manually:\n${commands.map((cmd) => `  $ ${cmd}`).join("\n")}`
      );
    }
  } else if (exitCode === EXIT_VERIFICATION_FAILED) {
    ui.log.warn(
      "Hint: Fix the verification issues and run 'sentry init' again."
    );
  }

  const docsUrl = inner?.docsUrl;
  if (docsUrl) {
    ui.log.info(`Docs: ${terminalLink(docsUrl)}`);
  }

  ui.cancel("Setup failed");
  ui.feedback("failed");
}
