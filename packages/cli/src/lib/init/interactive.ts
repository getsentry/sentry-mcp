/**
 * Interactive Dispatcher
 *
 * Handles interactive prompts from the remote workflow.
 * Supports select, multi-select, and confirm prompts.
 * Respects --yes flag for non-interactive mode.
 *
 * All UI I/O goes through the injected `WizardUI` so the dispatcher
 * works identically against `InkUI` (interactive Bun binary) and
 * `LoggingUI` (CI / npm fallback).
 */

import { setTag } from "@sentry/node-core/light";
import chalk from "chalk";
import { WizardError } from "../errors.js";
import {
  abortIfCancelled,
  featureHint,
  featureLabel,
  sortFeatures,
} from "./clack-utils.js";
import { REQUIRED_FEATURE } from "./constants.js";
import type {
  ConfirmPayload,
  InteractiveContext,
  InteractivePayload,
  MultiSelectPayload,
  SelectPayload,
} from "./types.js";
import type { WizardUI } from "./ui/types.js";

function prependRequiredFeature(
  features: string[],
  hasRequired: boolean
): string[] {
  if (!(hasRequired && !features.includes(REQUIRED_FEATURE))) {
    return features;
  }
  return [REQUIRED_FEATURE, ...features];
}

export async function handleInteractive(
  payload: InteractivePayload,
  options: InteractiveContext,
  ui: WizardUI
): Promise<Record<string, unknown>> {
  switch (payload.kind) {
    case "select":
      return await handleSelect(payload, options, ui);
    case "multi-select":
      return await handleMultiSelect(payload, options, ui);
    case "confirm":
      return await handleConfirm(payload, options, ui);
    default:
      throw new WizardError(
        `Unsupported interactive prompt kind: "${(payload as { kind: string }).kind}"`,
        { rendered: false }
      );
  }
}

type AppEntry = { name: string; path: string; framework?: string };

function formatAppList(apps: AppEntry[], items: string[]): string[] {
  // Name-based lookup keeps this correct even when payload.options and
  // payload.apps arrive with different lengths.
  const nameWidth = Math.max(1, ...items.map((n) => n.length));
  return items.map((name) => {
    const meta = apps.find((a) => a.name === name);
    const fw = meta?.framework ? ` (${meta.framework})` : "";
    const path = meta?.path ? `  ${meta.path}` : "";
    return `  ${name.padEnd(nameWidth)}${fw}${path}`;
  });
}

function buildMultiAppMessage(apps: AppEntry[], items: string[]): string {
  const exampleApp = items[0] ?? "<app>";
  return [
    `This monorepo has ${items.length} apps. Use --app to specify which one to initialize:`,
    "",
    `  sentry init --yes --features <features> --app ${exampleApp}`,
    "",
    "Available apps:",
    ...formatAppList(apps, items),
    "",
    "Or run without --yes to pick interactively:",
    "  sentry init",
  ].join("\n");
}

function buildAppNotFoundMessage(
  requested: string,
  apps: AppEntry[],
  items: string[]
): string {
  const exampleApp = items[0] ?? "<app>";
  return [
    `App "${requested}" not found in this monorepo.`,
    "",
    "Available apps:",
    ...formatAppList(apps, items),
    "",
    "Re-run with --app <name>, for example:",
    `  sentry init --yes --features <features> --app ${exampleApp}`,
  ].join("\n");
}

async function handleSelect(
  payload: SelectPayload,
  options: InteractiveContext,
  ui: WizardUI
): Promise<Record<string, unknown>> {
  const apps = payload.apps ?? [];
  const items = payload.options ?? apps.map((a) => a.name);

  if (items.length === 0) {
    throw new WizardError("No options available for this selection.", {
      rendered: false,
    });
  }

  if (options.app && payload.apps && payload.apps.length > 0) {
    const match = items.find(
      (item) => item.toLowerCase() === options.app?.toLowerCase()
    );
    if (!match) {
      const message = buildAppNotFoundMessage(options.app, apps, items);
      ui.log.error(message);
      throw new WizardError(message, { rendered: true });
    }
    ui.log.info(`Using app: ${match}`);
    return { selectedApp: match };
  }

  if (options.yes && items.length === 1) {
    ui.log.info(`Auto-selected: ${items[0]}`);
    return { selectedApp: items[0] };
  }

  if (options.yes && payload.apps && payload.apps.length > 0) {
    const message = buildMultiAppMessage(apps, items);
    ui.log.error(message);
    throw new WizardError(message, { rendered: true });
  }

  const selected = await ui.select<string>({
    message: payload.prompt,
    options: items.map((item) => {
      const app = apps.find((a) => a.name === item);
      return {
        value: item,
        label: item,
        ...(app?.framework ? { hint: app.framework } : {}),
      };
    }),
  });

  return { selectedApp: abortIfCancelled(selected) };
}

async function handleMultiSelect(
  payload: MultiSelectPayload,
  options: InteractiveContext,
  ui: WizardUI
): Promise<Record<string, unknown>> {
  const available = payload.availableFeatures ?? payload.options ?? [];

  if (available.length === 0) {
    return { features: [] };
  }

  const hasRequired = available.includes(REQUIRED_FEATURE);

  if (options.yes) {
    ui.log.info(
      `Auto-selected all features: ${available.map(featureLabel).join(", ")}`
    );
    return { features: available };
  }

  const optional = sortFeatures(
    available.filter((f) => f !== REQUIRED_FEATURE)
  );

  if (optional.length === 0) {
    if (hasRequired) {
      ui.log.info(`${featureLabel(REQUIRED_FEATURE)} is always included.`);
    }
    return { features: hasRequired ? [REQUIRED_FEATURE] : [] };
  }

  const hints: string[] = [];
  // Use clack's vertical bar character so hint lines align with the option lines below
  const bar = chalk.gray("\u2502");
  if (hasRequired) {
    hints.push(
      `${bar}  ${chalk.dim(`${featureLabel(REQUIRED_FEATURE)} is always included`)}`
    );
  }
  hints.push(`${bar}  ${chalk.dim("space=toggle, a=all, enter=confirm")}`);

  setTag("wizard.features.offered", available.join(","));
  const selected = await ui.multiselect<string>({
    message: `${payload.prompt}\n${hints.join("\n")}`,
    options: optional.map((feature) => {
      const hint = featureHint(feature);
      return {
        value: feature,
        label: featureLabel(feature),
        ...(hint ? { hint } : {}),
      };
    }),
    initialValues: optional.filter((f) => f === "performanceMonitoring"),
    required: false,
  });

  const chosen = abortIfCancelled(selected);
  const features = prependRequiredFeature(chosen, hasRequired);
  setTag("wizard.features.selected", features.join(","));
  return { features };
}

async function handleConfirm(
  payload: ConfirmPayload,
  options: InteractiveContext,
  ui: WizardUI
): Promise<Record<string, unknown>> {
  if (options.yes) {
    ui.log.info("Auto-confirmed: continuing");
    return { action: "continue" };
  }

  const confirmed = await ui.confirm({
    message: payload.prompt,
    initialValue: true,
  });

  const value = abortIfCancelled(confirmed);
  return { action: value ? "continue" : "stop" };
}
