import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  requestInitForceExit,
  scheduleInitForceExitIfRequested,
} from "../../../src/lib/init/force-exit.js";

const originalPlatform = process.platform;
const originalNodeEnv = process.env.NODE_ENV;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

beforeEach(() => {
  setPlatform("linux");
  process.env.NODE_ENV = "test";
  scheduleInitForceExitIfRequested();
});

afterEach(() => {
  process.env.NODE_ENV = "test";
  scheduleInitForceExitIfRequested();
  vi.restoreAllMocks();
  setPlatform(originalPlatform);
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

describe("init force-exit safety net", () => {
  test("does nothing until init requests the safety net", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    scheduleInitForceExitIfRequested();

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  test("schedules the macOS safety net after the outer pipeline finishes", () => {
    const unref = vi.fn();
    const timeout = { unref } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockReturnValue(timeout);
    setPlatform("darwin");
    process.env.NODE_ENV = "production";
    requestInitForceExit();

    scheduleInitForceExitIfRequested();

    expect(setTimeoutSpy).toHaveBeenCalledOnce();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 100);
    expect(unref).toHaveBeenCalledOnce();
  });

  test("consumes requests without scheduling outside macOS", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    requestInitForceExit();

    scheduleInitForceExitIfRequested();
    setPlatform("darwin");
    process.env.NODE_ENV = "production";
    scheduleInitForceExitIfRequested();

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });
});
