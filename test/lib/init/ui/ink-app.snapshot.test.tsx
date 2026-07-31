/**
 * Smoke-test the Ink App by mounting it with mocked stdin/stdout
 * inside `bun test`. Verifies the full-screen layout (tabbed
 * content and keyboard hints) without needing a real TTY.
 *
 * Note: The first Ink render() in a bun test CI worker can hang
 * indefinitely (Ink's internal reconciler keeps the event loop
 * alive in non-TTY). Tests that call renderApp() rely on a 500ms
 * timeout race to prevent blocking.
 */

import { Readable, Writable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { render } from "ink";
import { createElement } from "react";
import { describe, expect, test } from "vitest";
import {
  bannerLinesWidth,
  FULL_BANNER_LINES,
} from "../../../../src/lib/banner.js";
import {
  App,
  formatFeedbackBanner,
} from "../../../../src/lib/init/ui/ink-app.js";
import { WizardStore } from "../../../../src/lib/init/ui/wizard-store.js";

const LEARN_HEADER_RE = /How Sentry Works/;
const TASKS_HEADER_RE = /Tasks\b/;
const STATUS_TAB_RE = /Status/;
const FILES_TAB_RE = /Files/;
const FILES_HEADER_PINNED_RE = /Files analyzed\s+\d+\/\d+/;
const FILES_HEADER_UNPINNED_RE = /Files analyzed\s+\u2191\s+\d+\/\d+/;
const KEYBOARD_HINT_RE = /switch tab/;
const SPACE_TOGGLE_HINT_RE = /space\s+toggle/;
const A_ALL_HINT_RE = /a\s+all/;
const ENTER_CONFIRM_HINT_RE = /enter\s+confirm/;
const ESC_CANCEL_HINT_RE = /esc\s+cancel/;
const COMPLETED_SELECTING_FEATURES_RE = /✔\s+Selecting features/;
const ANSI_ESCAPE_PREFIX = "\u001B[";
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences in captured Ink output
const ANSI_CSI_RE = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences in captured Ink output
const ANSI_OSC_RE = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g;
const LINE_SPLIT_RE = /\r?\n/;
const RIGHT_ARROW = "\u001B[C";
const FEEDBACK_BANNER_TEXT = '$ sentry cli feedback "what worked or broke"';

const FRAME_SETTLE_MS = 80;
const TEST_BANNER_ROWS = [
  { content: "  ███████╗███████╗███╗   ██╗", color: "#B4A4DE" },
  { content: "  ╚══════╝╚══════╝╚═╝  ╚═══╝", color: "#432B8A" },
];

class CaptureStream extends Writable {
  frames: string[] = [];
  columns: number;
  rows: number;
  isTTY = true;
  constructor(columns = 120, rows = 40) {
    super();
    this.columns = columns;
    this.rows = rows;
  }
  _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.frames.push(chunk.toString());
    cb();
  }
  allOutput(): string {
    return this.frames.join("");
  }
}

function makeStdin(): Readable {
  const s = new Readable({
    read() {
      // No keystrokes in tests — Ink reads from this stream but
      // we never push data.
    },
  });
  const shim = s as Readable & {
    isTTY: boolean;
    setRawMode: (v: boolean) => Readable;
    resume: () => Readable;
    pause: () => Readable;
    ref: () => Readable;
    unref: () => Readable;
  };
  shim.isTTY = true;
  shim.setRawMode = () => s;
  shim.resume = () => s;
  shim.pause = () => s;
  shim.ref = () => s;
  shim.unref = () => s;
  return s;
}

async function renderApp(
  store: WizardStore,
  columns: number,
  options: { rows?: number; input?: string[] } = {}
): Promise<CaptureStream> {
  const out = new CaptureStream(columns, options.rows ?? 40);
  const stdin = makeStdin();
  const instance = render(createElement(App, { store }), {
    stdout: out as unknown as NodeJS.WriteStream,
    stderr: out as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  for (const input of options.input ?? []) {
    stdin.push(input);
    await sleep(20);
  }
  await sleep(FRAME_SETTLE_MS);
  instance.unmount();
  // waitUntilExit() hangs in CI — race with a short unref'd timeout.
  await Promise.race([
    instance.waitUntilExit().catch(() => {
      // Ink may reject on unmount — ignore.
    }),
    new Promise<void>((r) => {
      const t = setTimeout(r, 500);
      if (typeof t === "object" && "unref" in t) {
        t.unref();
      }
    }),
  ]);
  return out;
}

function hasForcedWhiteForeground(output: string): boolean {
  return (
    output.includes(`${ANSI_ESCAPE_PREFIX}37m`) ||
    output.includes(`${ANSI_ESCAPE_PREFIX}97m`) ||
    output.includes(`${ANSI_ESCAPE_PREFIX}38;2;255;255;255m`)
  );
}

function withoutFeedbackBanner(output: string): string {
  return output
    .split(LINE_SPLIT_RE)
    .filter((line) => !line.includes(FEEDBACK_BANNER_TEXT))
    .join("\n");
}

function stripAnsi(output: string): string {
  return output.replace(ANSI_CSI_RE, "").replace(ANSI_OSC_RE, "");
}

function firstLogoLineIndex(output: string): number {
  return stripAnsi(output)
    .split(LINE_SPLIT_RE)
    .findIndex((line) => line.includes("███████╗███████╗"));
}

function ignorePromptResolution(): void {
  // Snapshot tests render the prompt but never submit it.
}

function setWelcomePrompt(store: WizardStore): void {
  store.setPrompt({
    kind: "welcome",
    options: {
      title: "Sentry Init",
      body: [
        "We'll use AI to inspect this project and configure Sentry.",
        "You'll choose the setup before local files change.",
      ],
      punchline: "Continue to let Sentry use AI for setup.",
    },
    resolve: ignorePromptResolution,
  });
}

function makeReadFiles(count: number): string[] {
  return Array.from(
    { length: count },
    (_value, index) => `src/file-${String(index + 1).padStart(2, "0")}.ts`
  );
}

describe("Ink App snapshot", () => {
  test("feedback banner reserves padding on both edges", () => {
    const banner = formatFeedbackBanner(120, "0.32.0-test.0");

    expect(banner.length).toBe(120);
    expect(banner.startsWith(" Sentry v0.32.0-test.0")).toBe(true);
    expect(banner).toContain(FEEDBACK_BANNER_TEXT);
    expect(banner.endsWith(" ")).toBe(true);
  });

  test("renders full-screen layout at 120 cols", async () => {
    const store = new WizardStore();
    store.appendLog("info", "Hello world");
    store.appendLog("success", "Working\u2026");

    const frame = (await renderApp(store, 120)).allOutput();
    expect(frame).toMatch(LEARN_HEADER_RE);
    expect(frame).toContain("App → SDK → Sentry → Issue");
    expect(frame).toContain("The SDK runs in your app.");
    expect(frame).toContain("become issues with the clues");
    expect(frame).toContain("1/7");
    expect(frame).toMatch(TASKS_HEADER_RE);
    expect(frame).toContain("Hello world");
    expect(frame).toContain("Working\u2026");
    expect(frame).toMatch(STATUS_TAB_RE);
    expect(frame).toMatch(FILES_TAB_RE);
    expect(frame).toMatch(KEYBOARD_HINT_RE);
  });

  test("renders the second learn card about debugging context", async () => {
    const store = new WizardStore({
      learnState: { blockIndex: 1, lineIndex: 0, complete: false },
    });
    store.appendLog("info", "Reading project context");

    const frame = (await renderApp(store, 120)).allOutput();
    expect(frame).toContain("Debug With Context");
    expect(frame).toContain("Issue → Trace → Replay → Fix");
    expect(frame).toContain("That context points to the fix.");
    expect(frame).toContain("2/7");
  });

  test("keeps tasks above rotating tips", async () => {
    const store = new WizardStore({
      learnState: { blockIndex: 0, lineIndex: 0, complete: true },
    });

    const frame = stripAnsi((await renderApp(store, 120)).allOutput());
    expect(frame).toContain("Did you know?");
    expect(frame.indexOf("Tasks")).toBeLessThan(frame.indexOf("Did you know?"));
  });

  test("renders single-column layout at narrow width", async () => {
    const store = new WizardStore();
    store.appendLog("info", "Narrow terminal");

    const frame = (await renderApp(store, 60)).allOutput();
    expect(frame).toContain("Narrow terminal");
    expect(frame).toMatch(STATUS_TAB_RE);
  });

  test("workflow screen does not repeat status messages in the footer", async () => {
    const store = new WizardStore();
    store.appendStatus("Analyzing project...");
    store.appendStatus("Reading package.json");

    const frame = (await renderApp(store, 120)).allOutput();
    expect(frame).not.toContain("Analyzing project...");
    expect(frame).not.toContain("Reading package.json");
  });

  test("status history shortcut is not shown", async () => {
    const store = new WizardStore();
    store.appendStatus("Analyzing project...");
    store.appendStatus("Reading package.json");
    store.appendStatus("Installing SDK");

    const frame = (await renderApp(store, 120)).allOutput();
    expect(frame).not.toContain("toggle status");
  });

  test("focused prompt text inherits terminal foreground", async () => {
    const store = new WizardStore({ bannerRows: [], layout: "intro" });
    store.setPrompt({
      kind: "select",
      message: "Choose a feature",
      options: [
        { value: "errors", label: "Error Monitoring" },
        { value: "tracing", label: "Tracing" },
      ],
      initialIndex: 0,
      resolve: ignorePromptResolution,
    });

    const frame = (await renderApp(store, 120)).allOutput();
    expect(frame).toContain("Choose a feature");
    expect(frame).toContain("Error Monitoring");
    expect(hasForcedWhiteForeground(withoutFeedbackBanner(frame))).toBe(false);
  });

  test("workflow screen hides logo and shows feedback banner", async () => {
    const store = new WizardStore({
      bannerRows: TEST_BANNER_ROWS,
      cliVersion: "0.32.0-test.0",
    });
    store.appendLog("info", "Checking project...");

    const frame = (await renderApp(store, 120)).allOutput();
    expect(frame).not.toContain("███████╗███████╗");
    expect(frame).toContain(FEEDBACK_BANNER_TEXT);
    expect(frame).toContain("Sentry v0.32.0-test.0");

    const plainFrame = stripAnsi(frame);
    const bannerLine = plainFrame
      .split(LINE_SPLIT_RE)
      .find((line) => line.includes("Sentry v") && line.includes("feedback"));
    expect(bannerLine).toBeDefined();
    expect(bannerLine?.indexOf("Sentry v0.32.0-test.0")).toBeLessThan(
      bannerLine?.indexOf("$ sentry cli feedback") ?? 0
    );
  });

  test("welcome screen is centered and standalone", async () => {
    const store = new WizardStore({ bannerRows: TEST_BANNER_ROWS });
    setWelcomePrompt(store);

    const frame = (await renderApp(store, 120)).allOutput();
    expect(frame).toContain("███████╗███████╗");
    expect(frame).not.toContain("Sentry Init");
    expect(frame).toContain("We'll use AI to inspect this project");
    expect(frame).toContain("Continue to let Sentry use AI for setup.");
    expect(frame).toContain("Continue");
    expect(frame).toContain("Cancel");
    expect(frame).not.toMatch(LEARN_HEADER_RE);
    expect(frame).not.toMatch(TASKS_HEADER_RE);
    expect(frame).not.toMatch(STATUS_TAB_RE);
    expect(frame).not.toMatch(FILES_TAB_RE);
    expect(frame).toContain(FEEDBACK_BANNER_TEXT);
    expect(hasForcedWhiteForeground(withoutFeedbackBanner(frame))).toBe(false);
  });

  test("welcome banner preserves row alignment while centering the art", async () => {
    const store = new WizardStore({ bannerRows: FULL_BANNER_LINES });
    setWelcomePrompt(store);

    const terminalColumns = 120;
    const frame = stripAnsi(
      (await renderApp(store, terminalColumns)).allOutput()
    );
    const lines = frame.split(LINE_SPLIT_RE);
    const bannerOrigin = Math.floor(
      (terminalColumns - bannerLinesWidth(FULL_BANNER_LINES)) / 2
    );

    for (const { content } of FULL_BANNER_LINES) {
      const visibleContent = content.trimStart();
      const leadingSpaces = content.length - visibleContent.length;
      const renderedRow = lines.find((line) => line.includes(visibleContent));

      expect(renderedRow).toBeDefined();
      expect(renderedRow?.indexOf(visibleContent)).toBe(
        bannerOrigin + leadingSpaces
      );
    }
  });

  test("intro banner shrinks to fit narrow terminals (never wraps)", async () => {
    // A banner wider than the narrow terminal; distinctive marker so we can tell
    // whether it was rendered verbatim or replaced by a fitting variant.
    const wideRow = "Z".repeat(78);
    const makeStore = () =>
      new WizardStore({
        bannerRows: [{ content: wideRow, color: "#B4A4DE" }],
        layout: "intro",
      });

    // Wide terminal: the provided rows fit, so they render as-is.
    const wide = (await renderApp(makeStore(), 120)).allOutput();
    expect(wide).toContain("Z".repeat(40));

    // Narrow terminal (e.g. split pane): the too-wide rows are replaced by the
    // widest fitting variant (the block wordmark), so nothing wraps.
    const narrow = (await renderApp(makeStore(), 60)).allOutput();
    expect(narrow).not.toContain("Z".repeat(20));
    expect(narrow).toContain("████");
  });

  test("intro preflight prompts stay centered and standalone", async () => {
    const store = new WizardStore({
      bannerRows: TEST_BANNER_ROWS,
      layout: "intro",
    });
    store.appendLog("warn", "You have uncommitted or untracked files.");
    store.appendLog("success", "Prerequisites OK");
    store.setPrompt({
      kind: "confirm",
      message: "Continue with uncommitted changes?",
      initialValue: true,
      resolve: ignorePromptResolution,
    });

    const frame = (await renderApp(store, 120)).allOutput();
    expect(frame).toContain("███████╗███████╗");
    expect(frame).not.toContain("Sentry Init");
    expect(frame).not.toContain("uncommitted or untracked files");
    expect(frame).not.toContain("Prerequisites OK");
    expect(frame).toContain("Continue with uncommitted changes?");
    expect(frame).not.toContain("We'll use AI to inspect this project");
    expect(frame).not.toContain("Continue to let Sentry use AI for setup.");
    expect(frame).not.toContain("◇ Continue with uncommitted changes?");
    expect(frame).not.toMatch(LEARN_HEADER_RE);
    expect(frame).not.toMatch(TASKS_HEADER_RE);
    expect(frame).not.toMatch(STATUS_TAB_RE);
    expect(frame).not.toMatch(FILES_TAB_RE);
    expect(frame).not.toContain("switch tab");
    expect(frame).toContain(FEEDBACK_BANNER_TEXT);
    expect(hasForcedWhiteForeground(withoutFeedbackBanner(frame))).toBe(false);
  });

  test("intro logo row stays fixed across prompt heights", async () => {
    const shortPrompt = new WizardStore({
      bannerRows: TEST_BANNER_ROWS,
      layout: "intro",
    });
    shortPrompt.setPrompt({
      kind: "confirm",
      message: "Continue with setup?",
      initialValue: true,
      resolve: ignorePromptResolution,
    });

    const longPrompt = new WizardStore({
      bannerRows: TEST_BANNER_ROWS,
      layout: "intro",
    });
    longPrompt.setPrompt({
      kind: "select",
      message:
        "Choose the Sentry project and team context to use for this initialization before setup continues.",
      options: [
        { value: "recommended", label: "Use the detected project" },
        { value: "existing", label: "Choose an existing project" },
        { value: "create", label: "Create a new project" },
        { value: "team", label: "Change team first" },
        { value: "cancel", label: "Cancel setup" },
      ],
      initialIndex: 0,
      resolve: ignorePromptResolution,
    });

    const shortFrame = (
      await renderApp(shortPrompt, 120, { rows: 24 })
    ).allOutput();
    const longFrame = (
      await renderApp(longPrompt, 120, { rows: 24 })
    ).allOutput();

    const shortLogoLine = firstLogoLineIndex(shortFrame);
    const longLogoLine = firstLogoLineIndex(longFrame);
    expect(shortLogoLine).toBeGreaterThanOrEqual(0);
    expect(longLogoLine).toBe(shortLogoLine);
  });

  test("feature multiselect shows available features directly", async () => {
    const store = new WizardStore({ bannerRows: [] });
    store.setPrompt({
      kind: "multiselect",
      message: "Select features",
      options: [
        { value: "sessionReplay", label: "Session Replay" },
        {
          value: "performanceMonitoring",
          label: "Tracing",
          hint: "See request paths, spans, and bottlenecks",
        },
        { value: "sourceMaps", label: "Source Maps" },
      ],
      initialSelected: [],
      required: false,
      resolve: ignorePromptResolution,
    });

    const frame = (await renderApp(store, 120)).allOutput();
    const plainFrame = stripAnsi(frame);
    expect(frame).toContain("Session Replay");
    expect(frame).toContain("Tracing");
    expect(frame).toContain("See request paths, spans, and bottlenecks");
    expect(frame).toContain("Source Maps");
    expect(plainFrame).toContain("0/3");
    expect(plainFrame).not.toContain(
      "space toggle • a all • enter confirm • esc cancel"
    );
    expect(plainFrame).toMatch(SPACE_TOGGLE_HINT_RE);
    expect(plainFrame).toMatch(A_ALL_HINT_RE);
    expect(plainFrame).toMatch(ENTER_CONFIRM_HINT_RE);
    expect(plainFrame).toMatch(ESC_CANCEL_HINT_RE);
    expect(frame).not.toContain("Recommended setup");
    expect(frame).not.toContain("Apply recommended setup");
  });

  test("workflow prompts hide routine logs but keep warnings and tasks", async () => {
    const store = new WizardStore({ bannerRows: [] });
    store.appendLog(
      "success",
      'Using existing project "nextjs-sentry-test" in bete-dev'
    );
    store.appendLog("success", "Selecting features");
    store.appendLog("info", "Routine context loaded");
    store.appendLog("message", "Internal progress detail");
    store.appendLog("warn", "Heads up before choosing features");
    store.appendLog("error", "Something needs attention");
    store.setPrompt({
      kind: "multiselect",
      message: "Select features",
      options: [
        { value: "sessionReplay", label: "Session Replay" },
        { value: "profiling", label: "Profiling" },
      ],
      initialSelected: [],
      required: false,
      resolve: ignorePromptResolution,
    });

    const frame = (await renderApp(store, 120)).allOutput();
    const plainFrame = stripAnsi(frame);
    expect(frame).not.toContain("Using existing project");
    expect(plainFrame).not.toMatch(COMPLETED_SELECTING_FEATURES_RE);
    expect(frame).not.toContain("Routine context loaded");
    expect(frame).not.toContain("Internal progress detail");
    expect(frame).toContain("Heads up before choosing features");
    expect(frame).toContain("Something needs attention");
    expect(frame).toContain("Select features");
    expect(frame).toMatch(TASKS_HEADER_RE);
  });

  test("prompt shortcuts replace app shortcuts while prompt is active", async () => {
    const store = new WizardStore({ bannerRows: [] });
    store.setPrompt({
      kind: "select",
      message: "Choose a feature",
      options: [
        { value: "errors", label: "Error Monitoring" },
        { value: "tracing", label: "Tracing" },
      ],
      initialIndex: 0,
      resolve: ignorePromptResolution,
    });

    const frame = (await renderApp(store, 120)).allOutput();
    expect(frame).toContain("navigate");
    expect(frame).toContain("confirm");
    expect(frame).toContain("cancel");
    expect(frame).not.toContain("switch tab");
  });

  test("file scroll shortcut appears only when the file tree overflows", async () => {
    const shortTree = new WizardStore({ bannerRows: [] });
    shortTree.recordFilesReading(["src/app.ts"]);
    shortTree.markFilesAnalyzed(["src/app.ts"]);

    const shortFrame = (
      await renderApp(shortTree, 120, {
        input: [RIGHT_ARROW],
        rows: 16,
      })
    ).allOutput();
    expect(shortFrame).toMatch(FILES_HEADER_PINNED_RE);
    expect(shortFrame).not.toContain("scroll");

    const tallTree = new WizardStore({ bannerRows: [] });
    const readFiles = makeReadFiles(12);
    tallTree.recordFilesReading(readFiles);
    tallTree.markFilesAnalyzed(readFiles);

    const tallFrame = (
      await renderApp(tallTree, 120, {
        input: [RIGHT_ARROW],
        rows: 16,
      })
    ).allOutput();
    expect(tallFrame).toMatch(FILES_HEADER_PINNED_RE);
    expect(tallFrame).toContain("scroll");
  });

  test("Status screen shows logs and banner, not file tree", async () => {
    const store = new WizardStore();
    store.appendLog("info", "Checking project...");
    store.recordFilesReading(["package.json", "src/index.ts"]);
    store.markFilesAnalyzed(["package.json"]);

    const frame = (await renderApp(store, 120)).allOutput();
    expect(frame).toContain("Checking project...");
    expect(frame).not.toMatch(FILES_HEADER_PINNED_RE);
    expect(frame).not.toMatch(FILES_HEADER_UNPINNED_RE);
  });

  test("SummaryPanel renders featureBlurbs as Here's what we set up section", async () => {
    const store = new WizardStore({ bannerRows: [] });
    store.setSummary({
      fields: [{ label: "Platform", value: "javascript.nextjs" }],
      featureBlurbs: [
        {
          label: "Error Monitoring",
          blurb: "Captures every unhandled exception.",
        },
        { label: "Tracing", blurb: "Traces requests end-to-end." },
      ],
    });

    const frame = stripAnsi((await renderApp(store, 120)).allOutput());
    expect(frame).toContain("Here's what we set up");
    expect(frame).toContain("Error Monitoring");
    expect(frame).toContain("Captures every unhandled exception.");
    expect(frame).toContain("Tracing");
    expect(frame).toContain("Traces requests end-to-end.");
  });

  test("Ctrl+C path uses requestCancel via store, never bare process.exit", () => {
    let cancels = 0;
    const store = new WizardStore();
    store.setRequestCancel(() => {
      cancels += 1;
    });
    expect(store.getSnapshot().requestCancel).toBeDefined();
    store.getSnapshot().requestCancel?.();
    expect(cancels).toBe(1);
    store.setRequestCancel(undefined);
    expect(store.getSnapshot().requestCancel).toBeUndefined();
  });
});
