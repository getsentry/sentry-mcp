/**
 * Tests for clack-utils: WizardCancelledError, abortIfCancelled, featureLabel, featureHint.
 *
 * These are pure utility functions that don't require module mocking.
 */

import { describe, expect, test } from "vitest";
import {
  abortIfCancelled,
  featureHint,
  featureLabel,
  PROGRESS_ROTATE_INTERVAL_MS,
  STEP_ACTIVE_LABELS,
  STEP_PROGRESS_MESSAGES,
  sortFeatures,
  WizardCancelledError,
} from "../../../src/lib/init/clack-utils.js";

describe("WizardCancelledError", () => {
  test("has correct message", () => {
    const err = new WizardCancelledError();
    expect(err.message).toBe("Setup cancelled.");
  });

  test("has correct name", () => {
    const err = new WizardCancelledError();
    expect(err.name).toBe("WizardCancelledError");
  });

  test("is an instance of Error", () => {
    const err = new WizardCancelledError();
    expect(err).toBeInstanceOf(Error);
  });
});

describe("abortIfCancelled", () => {
  test("passes through non-cancel values", () => {
    expect(abortIfCancelled("hello")).toBe("hello");
    expect(abortIfCancelled(42)).toBe(42);
    expect(abortIfCancelled(null)).toBeNull();
  });

  test("passes through object values", () => {
    const obj = { key: "value" };
    expect(abortIfCancelled(obj)).toBe(obj);
  });
});

describe("featureLabel", () => {
  test("returns label for known feature", () => {
    expect(featureLabel("errorMonitoring")).toBe("Error Monitoring");
    expect(featureLabel("performanceMonitoring")).toBe("Tracing");
    expect(featureLabel("logs")).toBe("Logging");
    expect(featureLabel("crons")).toBe("Crons");
    expect(featureLabel("aiMonitoring")).toBe("AI Monitoring");
    expect(featureLabel("userFeedback")).toBe("User Feedback");
  });

  test("returns id as passthrough for unknown feature", () => {
    expect(featureLabel("unknownFeature")).toBe("unknownFeature");
  });
});

describe("featureHint", () => {
  test("returns hint for known feature", () => {
    expect(featureHint("errorMonitoring")).toBe(
      "Group exceptions into issues with context"
    );
    expect(featureHint("performanceMonitoring")).toBe(
      "See request paths, spans, and bottlenecks"
    );
    expect(featureHint("sessionReplay")).toBe(
      "Replay sessions linked to errors"
    );
    expect(featureHint("profiling")).toBe(
      "Find CPU-heavy functions in production"
    );
    expect(featureHint("logs")).toBe("Search logs beside errors and traces");
    expect(featureHint("metrics")).toBe("Track custom measurements over time");
    expect(featureHint("sourceMaps")).toBe(
      "Turn minified stacks into your source"
    );
    expect(featureHint("crons")).toBe(
      "Alert on failed or missed scheduled jobs"
    );
    expect(featureHint("aiMonitoring")).toBe(
      "Track AI calls, latency, cost, and failures"
    );
    expect(featureHint("userFeedback")).toBe(
      "Collect user reports with issue context"
    );
    expect(featureHint("reactFeatures")).toBe(
      "Add React-specific context and integrations"
    );
  });

  test("returns undefined for unknown feature", () => {
    expect(featureHint("unknownFeature")).toBeUndefined();
  });
});

describe("sortFeatures", () => {
  test("orders known features by canonical display order", () => {
    expect(
      sortFeatures([
        "userFeedback",
        "logs",
        "errorMonitoring",
        "sourceMaps",
        "crons",
        "aiMonitoring",
      ])
    ).toEqual([
      "errorMonitoring",
      "logs",
      "sourceMaps",
      "crons",
      "aiMonitoring",
      "userFeedback",
    ]);
  });

  test("keeps unknown features after known ones", () => {
    expect(sortFeatures(["unknown", "metrics", "another"])).toEqual([
      "metrics",
      "unknown",
      "another",
    ]);
  });
});

describe("STEP_PROGRESS_MESSAGES", () => {
  test("plan-codemods has multiple rotating messages", () => {
    const messages = STEP_PROGRESS_MESSAGES["plan-codemods"];
    expect(messages).toBeDefined();
    expect(messages!.length).toBeGreaterThanOrEqual(3);
    for (const msg of messages!) {
      expect(msg).toMatch(/\.\.\.$/);
    }
  });

  test("detect-platform has multiple rotating messages", () => {
    const messages = STEP_PROGRESS_MESSAGES["detect-platform"];
    expect(messages).toBeDefined();
    expect(messages!.length).toBeGreaterThanOrEqual(2);
  });

  test("every step with progress messages also has an active label", () => {
    for (const stepId of Object.keys(STEP_PROGRESS_MESSAGES)) {
      expect(STEP_ACTIVE_LABELS[stepId]).toBeDefined();
    }
  });

  test("rotation interval is a positive number", () => {
    expect(PROGRESS_ROTATE_INTERVAL_MS).toBeGreaterThan(0);
  });
});
