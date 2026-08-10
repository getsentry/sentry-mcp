/**
 * Unit tests for handleFinalResult in wizard-runner.ts.
 *
 * Kept as a mocked sibling file because vi.mock() on @sentry/node-core/light
 * would pollute the module graph for other wizard-runner tests that may not
 * want Sentry calls mocked.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  WizardOutput,
  WorkflowRunResult,
} from "../../src/lib/init/types.js";

// ============================================================================
// Mock Setup — must precede all imports of the module under test
// ============================================================================

const { tags } = vi.hoisted(() => ({
  tags: {} as Record<string, unknown>,
}));

vi.mock("@sentry/node-core/light", () => ({
  addBreadcrumb: () => null,
  captureException: () => null,
  getTraceData: () => ({}),
  setTag: (key: string, value: unknown) => {
    tags[key] = value;
  },
}));

import { WizardError } from "../../src/lib/errors.js";
// Import AFTER mock setup so the mocked module is used
import { handleFinalResult } from "../../src/lib/init/wizard-runner.js";

// ============================================================================
// Test helpers
// ============================================================================

function makeSpinnerHandle() {
  return { start: () => null, stop: () => null };
}

function makeSpinState(running = false) {
  return { running };
}

/** Minimal WizardUI stub — only the methods formatError touches. */
function makeUI() {
  const noop = () => null;
  return {
    log: { error: noop, warn: noop, info: noop, message: noop },
    cancel: noop,
    feedback: noop,
    summary: noop,
    outro: noop,
    intro: noop,
    setStep: noop,
    markFilesAnalyzed: noop,
  } as any;
}

function makeBailResult(
  partial: Partial<WizardOutput> = {}
): WorkflowRunResult {
  return {
    status: "success",
    result: { exitCode: 30, ...partial },
  };
}

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  for (const key of Object.keys(tags)) {
    delete tags[key];
  }
});

describe("handleFinalResult", () => {
  describe("WizardError message", () => {
    test("uses bail message from result.result.message when present", async () => {
      const result = makeBailResult({
        message:
          "Dependency installation failed after 5 attempts: pnpm exited with code 1",
      });

      await expect(
        handleFinalResult(
          result,
          makeSpinnerHandle(),
          makeSpinState(),
          makeUI()
        )
      ).rejects.toThrow(
        "Dependency installation failed after 5 attempts: pnpm exited with code 1"
      );
    });

    test("falls back to generic message when result.result.message is absent", async () => {
      const result = makeBailResult({ message: undefined });

      await expect(
        handleFinalResult(
          result,
          makeSpinnerHandle(),
          makeSpinState(),
          makeUI()
        )
      ).rejects.toThrow("Workflow returned an error");
    });
  });

  describe("wizard.exit_code tag", () => {
    test("tags wizard.exit_code with the workflow exit code", async () => {
      const result = makeBailResult({ exitCode: 11 });

      await expect(
        handleFinalResult(
          result,
          makeSpinnerHandle(),
          makeSpinState(),
          makeUI()
        )
      ).rejects.toThrow(WizardError);

      expect(tags["wizard.exit_code"]).toBe(11);
    });

    test("does not set wizard.exit_code when exitCode is absent", async () => {
      const result: WorkflowRunResult = {
        status: "failed",
        error: "network error",
      };

      await expect(
        handleFinalResult(
          result,
          makeSpinnerHandle(),
          makeSpinState(),
          makeUI()
        )
      ).rejects.toThrow(WizardError);

      expect(tags["wizard.exit_code"]).toBeUndefined();
    });
  });

  describe("WizardError message — result.error fallback", () => {
    test("uses result.error when result.result is absent (plain workflow failure)", async () => {
      const result: WorkflowRunResult = {
        status: "failed",
        error: "upstream network timeout",
      };

      await expect(
        handleFinalResult(
          result,
          makeSpinnerHandle(),
          makeSpinState(),
          makeUI()
        )
      ).rejects.toThrow("upstream network timeout");
    });
  });
});
