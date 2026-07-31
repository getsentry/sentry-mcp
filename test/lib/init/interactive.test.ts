/**
 * Interactive Dispatcher Tests
 *
 * Tests for the init wizard interactive prompt handlers. Uses a
 * `MockUI` that records calls and replays canned prompt responses, so
 * the dispatcher can be exercised without touching clack or any real
 * terminal.
 */

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as Sentry from "@sentry/node-core/light";
import { afterEach, describe, expect, test, vi } from "vitest";
import { WizardError } from "../../../src/lib/errors.js";
import { handleInteractive } from "../../../src/lib/init/interactive.js";
import type { InteractiveContext } from "../../../src/lib/init/types.js";
import { CANCELLED } from "../../../src/lib/init/ui/types.js";
import { createMockUI } from "./ui/mock-ui.js";

function makeOptions(
  overrides?: Partial<InteractiveContext>
): InteractiveContext {
  return {
    yes: false,
    dryRun: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleInteractive dispatcher", () => {
  test("throws WizardError for unknown kind", async () => {
    const { ui } = createMockUI();
    await expect(
      handleInteractive(
        { type: "interactive", prompt: "test", kind: "unknown" as "select" },
        makeOptions(),
        ui
      )
    ).rejects.toBeInstanceOf(WizardError);
  });
});

describe("handleSelect", () => {
  test("auto-selects single option with --yes", async () => {
    const { ui, calls } = createMockUI();
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Choose app",
        kind: "select",
        options: ["my-app"],
      },
      makeOptions({ yes: true }),
      ui
    );

    expect(result).toEqual({ selectedApp: "my-app" });
    expect(
      calls.some((c) => c.kind === "log.info" && c.message.includes("my-app"))
    ).toBe(true);
  });

  test("throws WizardError with app list when --yes and multiple apps", async () => {
    const { ui, calls } = createMockUI();
    await expect(
      handleInteractive(
        {
          type: "interactive",
          prompt: "Choose app",
          kind: "select",
          apps: [
            { name: "react", path: "/repo/apps/react" },
            { name: "vue", path: "/repo/apps/vue" },
          ],
        },
        makeOptions({ yes: true }),
        ui
      )
    ).rejects.toBeInstanceOf(WizardError);
    expect(calls.some((c) => c.kind === "log.error")).toBe(true);
  });

  test("falls through to ui.select when --yes and non-monorepo select", async () => {
    // --yes must not throw the monorepo error for select prompts that have
    // no payload.apps — only app-selection prompts provide that array.
    const { ui, respond } = createMockUI();
    respond.select("create");
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Found an existing project.",
        kind: "select",
        options: ["existing", "create"],
      },
      makeOptions({ yes: true }),
      ui
    );
    expect(result).toEqual({ selectedApp: "create" });
  });

  test("throws WizardError when options list is empty", async () => {
    const { ui } = createMockUI();
    await expect(
      handleInteractive(
        {
          type: "interactive",
          prompt: "Choose app",
          kind: "select",
          options: [],
        },
        makeOptions(),
        ui
      )
    ).rejects.toBeInstanceOf(WizardError);
  });

  test("uses apps array names when options not provided", async () => {
    const { ui } = createMockUI();
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Choose app",
        kind: "select",
        apps: [{ name: "express-app", path: "/app", framework: "Express" }],
      },
      makeOptions({ yes: true }),
      ui
    );

    expect(result).toEqual({ selectedApp: "express-app" });
  });

  test("calls ui.select in interactive mode", async () => {
    const { ui, calls, respond } = createMockUI();
    respond.select("vue");

    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Choose app",
        kind: "select",
        options: ["react", "vue"],
      },
      makeOptions({ yes: false }),
      ui
    );

    expect(result).toEqual({ selectedApp: "vue" });
    expect(calls.some((c) => c.kind === "select")).toBe(true);
  });

  test("throws WizardCancelledError on user cancellation", async () => {
    const { ui, respond } = createMockUI();
    respond.select(CANCELLED);

    await expect(
      handleInteractive(
        {
          type: "interactive",
          prompt: "Choose app",
          kind: "select",
          options: ["react", "vue"],
        },
        makeOptions({ yes: false }),
        ui
      )
    ).rejects.toThrow("Setup cancelled");
  });
});

describe("handleSelect with --app flag", () => {
  test("selects matching app by name", async () => {
    const { ui, calls } = createMockUI();
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Select the target application:",
        kind: "select",
        apps: [
          { name: "web", path: "/repo/apps/web", framework: "Next.js" },
          { name: "api", path: "/repo/apps/api", framework: "Express" },
        ],
      },
      makeOptions({ yes: true, app: "web" }),
      ui
    );

    expect(result).toEqual({ selectedApp: "web" });
    expect(
      calls.some((c) => c.kind === "log.info" && c.message.includes("web"))
    ).toBe(true);
  });

  test("matches --app case-insensitively", async () => {
    const { ui } = createMockUI();
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Select the target application:",
        kind: "select",
        apps: [{ name: "Web", path: "/repo/apps/web" }],
      },
      makeOptions({ app: "WEB" }),
      ui
    );

    expect(result).toEqual({ selectedApp: "Web" });
  });

  test("throws WizardError when --app name is not found", async () => {
    const { ui, calls } = createMockUI();
    await expect(
      handleInteractive(
        {
          type: "interactive",
          prompt: "Select the target application:",
          kind: "select",
          apps: [
            { name: "web", path: "/repo/apps/web" },
            { name: "api", path: "/repo/apps/api" },
          ],
        },
        makeOptions({ yes: true, app: "missing" }),
        ui
      )
    ).rejects.toBeInstanceOf(WizardError);
    const errorCall = calls.find((c) => c.kind === "log.error");
    expect(errorCall?.message).toContain("missing");
    expect(errorCall?.message).toContain("web");
  });

  test("ignores --app when payload has no apps array", async () => {
    // --app only activates for monorepo app-selection prompts (payload.apps present).
    // For other select prompts it must fall through to the normal interactive pick.
    const { ui, respond } = createMockUI();
    respond.select("existing");
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Found an existing project.",
        kind: "select",
        options: ["existing", "create"],
      },
      makeOptions({ app: "web" }),
      ui
    );

    expect(result).toEqual({ selectedApp: "existing" });
  });

  test("error message for --yes with multiple apps includes app names and --app hint", async () => {
    const { ui, calls } = createMockUI();
    await expect(
      handleInteractive(
        {
          type: "interactive",
          prompt: "Select the target application:",
          kind: "select",
          apps: [
            { name: "web", path: "/repo/apps/web", framework: "Next.js" },
            { name: "api", path: "/repo/apps/api" },
          ],
        },
        makeOptions({ yes: true }),
        ui
      )
    ).rejects.toBeInstanceOf(WizardError);
    const errorCall = calls.find((c) => c.kind === "log.error");
    expect(errorCall?.message).toContain("web");
    expect(errorCall?.message).toContain("api");
    expect(errorCall?.message).toContain("--app");
  });
});

describe("handleMultiSelect", () => {
  test("records offered and selected features for interactive prompts", async () => {
    const setTagSpy = vi.spyOn(Sentry, "setTag");
    const { ui, respond } = createMockUI();
    respond.multiselect(["sessionReplay"]);

    await handleInteractive(
      {
        type: "interactive",
        prompt: "Select features",
        kind: "multi-select",
        availableFeatures: [
          "errorMonitoring",
          "performanceMonitoring",
          "sessionReplay",
        ],
      },
      makeOptions(),
      ui
    );

    expect(setTagSpy).toHaveBeenCalledWith(
      "wizard.features.offered",
      "errorMonitoring,performanceMonitoring,sessionReplay"
    );
    expect(setTagSpy).toHaveBeenCalledWith(
      "wizard.features.selected",
      "errorMonitoring,sessionReplay"
    );
  });

  test("auto-selects all features with --yes", async () => {
    const { ui } = createMockUI();
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Select features",
        kind: "multi-select",
        availableFeatures: [
          "errorMonitoring",
          "performanceMonitoring",
          "sessionReplay",
        ],
      },
      makeOptions({ yes: true }),
      ui
    );

    expect(result.features).toEqual([
      "errorMonitoring",
      "performanceMonitoring",
      "sessionReplay",
    ]);
  });

  test("returns empty features when none available", async () => {
    const { ui } = createMockUI();
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Select features",
        kind: "multi-select",
        availableFeatures: [],
      },
      makeOptions(),
      ui
    );

    expect(result).toEqual({ features: [] });
  });

  test("prepends errorMonitoring when available but not user-selected", async () => {
    // User selects only sessionReplay, but errorMonitoring is available (required)
    const { ui, respond } = createMockUI();
    respond.multiselect(["sessionReplay"]);

    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Select features",
        kind: "multi-select",
        availableFeatures: [
          "errorMonitoring",
          "performanceMonitoring",
          "sessionReplay",
        ],
      },
      makeOptions({ yes: false }),
      ui
    );

    const features = result.features as string[];
    expect(features[0]).toBe("errorMonitoring");
    expect(features).toContain("sessionReplay");
  });

  test("throws WizardCancelledError when user cancels multi-select", async () => {
    const setTagSpy = vi.spyOn(Sentry, "setTag");
    const { ui, respond } = createMockUI();
    respond.multiselect(CANCELLED);

    await expect(
      handleInteractive(
        {
          type: "interactive",
          prompt: "Select features",
          kind: "multi-select",
          availableFeatures: ["errorMonitoring", "performanceMonitoring"],
        },
        makeOptions({ yes: false }),
        ui
      )
    ).rejects.toThrow("Setup cancelled");
    expect(setTagSpy).toHaveBeenCalledWith(
      "wizard.features.offered",
      "errorMonitoring,performanceMonitoring"
    );
    expect(setTagSpy).not.toHaveBeenCalledWith(
      "wizard.features.selected",
      expect.anything()
    );
  });

  test("returns required feature without calling multiselect when only errorMonitoring available", async () => {
    const { ui, calls } = createMockUI();
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Select features",
        kind: "multi-select",
        availableFeatures: ["errorMonitoring"],
      },
      makeOptions({ yes: false }),
      ui
    );

    expect(result).toEqual({ features: ["errorMonitoring"] });
    expect(calls.some((c) => c.kind === "multiselect")).toBe(false);
  });

  test("excludes errorMonitoring from multiselect options (always included)", async () => {
    const { ui, calls, respond } = createMockUI();
    respond.multiselect(["performanceMonitoring"]);

    await handleInteractive(
      {
        type: "interactive",
        prompt: "Select features",
        kind: "multi-select",
        availableFeatures: ["errorMonitoring", "performanceMonitoring"],
      },
      makeOptions({ yes: false }),
      ui
    );

    // The options passed to multiselect should NOT include errorMonitoring
    const multiselectCall = calls.find((c) => c.kind === "multiselect") as
      | Extract<(typeof calls)[number], { kind: "multiselect" }>
      | undefined;
    expect(multiselectCall).toBeDefined();
    expect(multiselectCall?.options).not.toContain("errorMonitoring");
    expect(multiselectCall?.options).toContain("performanceMonitoring");
  });

  test("shows available optional features without client-side recommendations", async () => {
    const { ui, calls, respond } = createMockUI();
    respond.multiselect(["sessionReplay"]);

    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Select features",
        kind: "multi-select",
        availableFeatures: [
          "errorMonitoring",
          "performanceMonitoring",
          "sourceMaps",
          "sessionReplay",
        ],
      },
      makeOptions({ yes: false }),
      ui
    );

    expect(result.features).toEqual(["errorMonitoring", "sessionReplay"]);

    const multiselectCall = calls.find((c) => c.kind === "multiselect") as
      | Extract<(typeof calls)[number], { kind: "multiselect" }>
      | undefined;
    expect(multiselectCall?.options).toEqual([
      "sessionReplay",
      "performanceMonitoring",
      "sourceMaps",
    ]);
    expect(multiselectCall?.initialValues).toEqual(["performanceMonitoring"]);
  });
});

describe("handleConfirm", () => {
  test("auto-confirms with action: continue for non-example prompts with --yes", async () => {
    const { ui } = createMockUI();
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Continue with setup?",
        kind: "confirm",
      },
      makeOptions({ yes: true }),
      ui
    );

    expect(result).toEqual({ action: "continue" });
  });

  test("throws WizardCancelledError when user cancels confirm", async () => {
    const { ui, respond } = createMockUI();
    respond.confirm(CANCELLED);

    await expect(
      handleInteractive(
        {
          type: "interactive",
          prompt: "Continue with setup?",
          kind: "confirm",
        },
        makeOptions({ yes: false }),
        ui
      )
    ).rejects.toThrow("Setup cancelled");
  });

  test("returns action: stop when user declines non-example prompt", async () => {
    const { ui, respond } = createMockUI();
    respond.confirm(false);

    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Continue with setup?",
        kind: "confirm",
      },
      makeOptions({ yes: false }),
      ui
    );

    expect(result).toEqual({ action: "stop" });
  });
});
