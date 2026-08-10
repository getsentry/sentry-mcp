// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as Sentry from "@sentry/node-core/light";
import { afterEach, describe, expect, test, vi } from "vitest";
import { InkUI } from "../../../../src/lib/init/ui/ink-ui.js";
import {
  CANCELLED,
  type Cancelled,
} from "../../../../src/lib/init/ui/types.js";
import { WizardStore } from "../../../../src/lib/init/ui/wizard-store.js";
import { createWizardPromptTelemetry } from "../../../../src/lib/telemetry.js";

function createUi(options: { initialWelcome?: boolean } = {}): {
  ui: InkUI;
  store: WizardStore;
} {
  const store = new WizardStore();
  const instance = {
    clear: vi.fn(),
    rerender: vi.fn(),
    unmount: vi.fn(),
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
  };
  if (!options.initialWelcome) {
    return { ui: new InkUI(instance, store, null), store };
  }

  let resolvePromise!: (value: "continue" | Cancelled) => void;
  const initialWelcome: {
    promise: Promise<"continue" | Cancelled>;
    tracedPromise?: Promise<"continue" | Cancelled>;
    resolve(value: "continue" | Cancelled): void;
    settled: boolean;
  } = {
    promise: new Promise<"continue" | Cancelled>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve(value: "continue" | Cancelled) {
      if (initialWelcome.settled) {
        return;
      }
      initialWelcome.settled = true;
      resolvePromise(value);
    },
    settled: false,
  };
  store.setPrompt({
    kind: "welcome",
    options: {
      title: "Welcome",
      body: ["Configure Sentry"],
      punchline: "Continue?",
    },
    resolve(value) {
      store.setPrompt(null);
      initialWelcome.resolve(value === null ? CANCELLED : value);
    },
  });
  const promptTelemetry = createWizardPromptTelemetry();
  return {
    ui: new InkUI(instance, store, null, {
      initialWelcome,
      telemetry: promptTelemetry,
    }),
    store,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InkUI prompt telemetry", () => {
  test("attributes workflow prompts to the active step", async () => {
    const metricSpy = vi.spyOn(Sentry.metrics, "distribution");
    const startSpanSpy = vi.spyOn(Sentry, "startSpan");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const { ui, store } = createUi();

    ui.setStep("select-features", "in_progress");
    const resultPromise = ui.multiselect({
      message: "Choose features",
      options: [{ label: "Tracing", value: "performanceMonitoring" }],
    });
    const prompt = store.getSnapshot().prompt;
    expect(prompt?.kind).toBe("multiselect");
    if (prompt?.kind !== "multiselect") {
      throw new Error("Expected a multiselect prompt");
    }
    prompt.resolve(["performanceMonitoring"]);

    await expect(resultPromise).resolves.toEqual(["performanceMonitoring"]);
    expect(metricSpy).toHaveBeenCalledWith(
      "wizard.user_wait_ms",
      expect.any(Number),
      {
        attributes: {
          prompt_kind: "multiselect",
          workflow_step: "select-features",
        },
      }
    );
    expect(startSpanSpy).toHaveBeenCalledWith(
      {
        name: "wizard.prompt.multiselect",
        op: "ui.prompt",
        onlyIfParent: true,
        attributes: {
          "wizard.prompt.kind": "multiselect",
          "wizard.prompt.phase": "workflow",
          "wizard.step.id": "select-features",
        },
      },
      expect.any(Function)
    );

    await ui[Symbol.asyncDispose]();
  });

  test("records the welcome prompt as preflight rather than a workflow step", async () => {
    const metricSpy = vi.spyOn(Sentry.metrics, "distribution");
    const startSpanSpy = vi.spyOn(Sentry, "startSpan");
    let now = 100;
    vi.spyOn(globalThis.performance, "now").mockImplementation(() => now);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const { ui, store } = createUi({ initialWelcome: true });

    expect(startSpanSpy).toHaveBeenCalledTimes(1);
    const prompt = store.getSnapshot().prompt;
    expect(prompt?.kind).toBe("welcome");
    if (prompt?.kind !== "welcome") {
      throw new Error("Expected a welcome prompt");
    }
    now = 150;
    prompt.resolve("continue");
    const resultPromise = ui.welcome({
      title: "Welcome",
      body: ["Configure Sentry"],
      punchline: "Continue?",
    });

    await expect(resultPromise).resolves.toBe("continue");
    expect(metricSpy).toHaveBeenCalledWith("wizard.user_wait_ms", 50, {
      attributes: { prompt_kind: "welcome" },
    });
    expect(startSpanSpy).toHaveBeenCalledWith(
      {
        name: "wizard.prompt.welcome",
        op: "ui.prompt",
        onlyIfParent: true,
        attributes: {
          "wizard.prompt.kind": "welcome",
          "wizard.prompt.phase": "preflight",
        },
      },
      expect.any(Function)
    );
    expect(startSpanSpy).toHaveBeenCalledTimes(1);

    await ui[Symbol.asyncDispose]();
  });
});
