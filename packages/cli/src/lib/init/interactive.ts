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
import { WizardError } from "../errors.js";
import {
  abortIfCancelled,
  featureDescription,
  featureLabel,
} from "./clack-utils.js";
import { REQUIRED_FEATURE } from "./constants.js";
import type {
  AppEntry,
  ConfirmPayload,
  InteractiveContext,
  InteractivePayload,
  MultiSelectPayload,
  SelectPayload,
} from "./types.js";
import type { PromptDetail, WizardUI } from "./ui/types.js";

type InteractiveUiOptions = {
  holdPresentationOnSelect?: boolean;
};

function prependRequiredFeature(features: string[]): string[] {
  if (features.includes(REQUIRED_FEATURE)) {
    return features;
  }
  return [REQUIRED_FEATURE, ...features];
}

type FeatureReviewAction = "continue" | "back";

const DEFAULT_FEATURE_ORDER = [
  REQUIRED_FEATURE,
  "logs",
  "sessionReplay",
  "performanceMonitoring",
] as const;
const DEFAULT_FEATURES = new Set<string>(DEFAULT_FEATURE_ORDER);
const DEFAULT_FEATURE_RANK = new Map<string, number>(
  DEFAULT_FEATURE_ORDER.map((feature, index) => [feature, index])
);
// These features need code-level choices this selector cannot configure yet.
const UNSUPPORTED_INIT_FEATURES = new Set([
  "attachments",
  "metrics",
  "userFeedback",
]);
const FEATURE_SELECTION_CONTEXT =
  "Based on your project, these features are available to set up.";

function sortFeatureOptions(features: string[]): string[] {
  return features.slice().sort((a, b) => {
    const rankDifference =
      (DEFAULT_FEATURE_RANK.get(a) ?? Number.MAX_SAFE_INTEGER) -
      (DEFAULT_FEATURE_RANK.get(b) ?? Number.MAX_SAFE_INTEGER);
    if (rankDifference !== 0) {
      return rankDifference;
    }
    return featureLabel(a).localeCompare(featureLabel(b), "en");
  });
}

function normalizeFeatureSelection(features: string[]): string[] {
  const normalized = new Set(features);
  // The server enforces this dependency too; normalizing before review keeps
  // the reviewed, resumed, and restored-on-Back selections identical.
  if (
    features.includes("aiMonitoring") ||
    features.includes("mcpObservability") ||
    features.includes("profiling")
  ) {
    normalized.add("performanceMonitoring");
  }
  return sortFeatureOptions([...normalized]);
}

function buildFeatureReviewDetails(features: string[]): PromptDetail[] {
  return [
    { text: "We'll add these features:" },
    ...features.map((feature) => ({
      text: `✓ ${featureLabel(feature)}`,
      tone: "success" as const,
    })),
  ];
}

export async function handleInteractive(
  payload: InteractivePayload,
  options: InteractiveContext,
  ui: WizardUI,
  uiOptions: InteractiveUiOptions = {}
): Promise<Record<string, unknown>> {
  switch (payload.kind) {
    case "select":
      return await handleSelect(payload, options, ui, uiOptions);
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

const APP_ROLE_LABELS: Record<NonNullable<AppEntry["role"]>, string> = {
  application: "Application",
  documentation: "Documentation website",
  example: "Reference application",
  runtime: "Runtime package",
};

function canAutoSelectSentrySetup(app: AppEntry): boolean {
  return app.sentrySetup === "auto-select";
}

function autoSelectTarget(
  items: string[],
  apps: AppEntry[],
  yes: boolean
): Record<string, unknown> | undefined {
  if (!yes) {
    return;
  }
  if (items.length === 1) {
    const onlyApp = apps.find((app) => app.name === items[0]);
    if (
      onlyApp?.sentrySetup === "detected" &&
      !canAutoSelectSentrySetup(onlyApp)
    ) {
      return;
    }
    return { selectedApp: items[0] };
  }
  const detectedTargets = apps.filter(canAutoSelectSentrySetup);
  if (detectedTargets.length !== 1) {
    return;
  }
  const selectedApp = detectedTargets[0]?.name;
  if (!selectedApp) {
    return;
  }
  return { selectedApp };
}

function formatAppList(apps: AppEntry[], items: string[]): string[] {
  // Name-based lookup keeps this correct even when payload.options and
  // payload.apps arrive with different lengths.
  const labels = items.map(
    (name) => apps.find((app) => app.name === name)?.label ?? name
  );
  const nameWidth = Math.max(1, ...labels.map((label) => label.length));
  return items.map((name) => {
    const meta = apps.find((a) => a.name === name);
    const label = meta?.label ?? name;
    const hint = meta ? appHint(meta) : "";
    const formattedHint = hint ? ` (${hint})` : "";
    const path = meta?.path ? `  ${meta.path}` : "";
    return `  ${label.padEnd(nameWidth)}${formattedHint}${path}`;
  });
}

function appHint(app: AppEntry): string {
  const parts: string[] = [];
  if (app.role) {
    parts.push(APP_ROLE_LABELS[app.role]);
  }
  if (app.framework) {
    parts.push(app.framework);
  }
  if (
    app.sentrySetup &&
    !parts.some((part) => part.toLowerCase().includes("sentry detected"))
  ) {
    parts.push("Sentry detected");
  }
  return parts.join(" · ");
}

function buildMultiAppMessage(apps: AppEntry[], items: string[]): string {
  const exampleApp = items[0] ?? "<app>";
  return [
    `This monorepo has ${items.length} targets. Use --app to specify which one to initialize:`,
    "",
    `  sentry init --yes --features <features> --app ${exampleApp}`,
    "",
    "Available targets:",
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
    "Available targets:",
    ...formatAppList(apps, items),
    "",
    "Re-run with --app <name>, for example:",
    `  sentry init --yes --features <features> --app ${exampleApp}`,
  ].join("\n");
}

async function handleSelect(
  payload: SelectPayload,
  options: InteractiveContext,
  ui: WizardUI,
  uiOptions: InteractiveUiOptions
): Promise<Record<string, unknown>> {
  const apps = payload.apps ?? [];
  const items = payload.options ?? apps.map((a) => a.name);

  if (items.length === 0) {
    throw new WizardError("No options available for this selection.", {
      rendered: false,
    });
  }

  if (options.app && payload.apps && payload.apps.length > 0) {
    const match = apps.find(
      (app) => app.name.toLowerCase() === options.app?.toLowerCase()
    );
    if (!match) {
      const message = buildAppNotFoundMessage(options.app, apps, items);
      ui.log.error(message);
      throw new WizardError(message, { rendered: true });
    }
    ui.log.info(`Using app: ${match.label ?? match.name}`);
    return { selectedApp: match.name };
  }

  const autoSelected = autoSelectTarget(items, apps, options.yes);
  if (autoSelected) {
    return autoSelected;
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
        label: app?.label ?? item,
        ...(app && appHint(app) ? { hint: appHint(app) } : {}),
      };
    }),
    ...(uiOptions.holdPresentationOnSelect
      ? { holdPresentationOnResolve: true }
      : {}),
  });

  return { selectedApp: abortIfCancelled(selected) };
}

async function handleMultiSelect(
  payload: MultiSelectPayload,
  options: InteractiveContext,
  ui: WizardUI
): Promise<Record<string, unknown>> {
  const available = prependRequiredFeature(
    (payload.availableFeatures ?? payload.options ?? []).filter(
      (feature) => !UNSUPPORTED_INIT_FEATURES.has(feature)
    )
  );
  const detectedExisting = (payload.initialFeatures ?? []).filter((feature) =>
    available.includes(feature)
  );

  if (options.yes) {
    const defaults = normalizeFeatureSelection(
      available.filter(
        (feature) =>
          DEFAULT_FEATURES.has(feature) || detectedExisting.includes(feature)
      )
    );
    ui.log.info(
      `Auto-selected default features: ${defaults.map(featureLabel).join(", ")}`
    );
    return { features: defaults };
  }

  const sorted = sortFeatureOptions(available);
  setTag("wizard.features.offered", available.join(","));
  let initialValues: string[] = sorted.filter(
    (feature) =>
      DEFAULT_FEATURES.has(feature) || detectedExisting.includes(feature)
  );

  while (true) {
    const selected = await ui.multiselect<string>({
      message: payload.prompt,
      details: [{ text: FEATURE_SELECTION_CONTEXT }],
      options: sorted.map((feature) => {
        const description = featureDescription(feature);
        return {
          value: feature,
          label: featureLabel(feature),
          ...(description ? { description } : {}),
          ...(feature === REQUIRED_FEATURE ? { locked: true } : {}),
        };
      }),
      initialValues,
      required: false,
    });

    const chosen = abortIfCancelled(selected);
    const features = normalizeFeatureSelection(prependRequiredFeature(chosen));
    const review = await ui.select<FeatureReviewAction>({
      message: "Review your Sentry setup",
      details: buildFeatureReviewDetails(features),
      footer: {
        text: "We'll modify project files for this Sentry setup.",
      },
      options: [
        { value: "continue", label: "Continue" },
        { value: "back", label: "Back" },
      ],
      initialValue: "continue",
    });

    if (abortIfCancelled(review) === "continue") {
      setTag("wizard.features.selected", features.join(","));
      return { features };
    }
    initialValues = features;
  }
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
