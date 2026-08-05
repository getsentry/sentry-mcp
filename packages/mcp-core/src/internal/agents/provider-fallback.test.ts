import { describe, expect, it, vi, beforeEach } from "vitest";
import { LLMProviderError } from "../../errors";
import { logWarn } from "../../telem/logging";
import { withProviderFallback } from "./provider-fallback";

vi.mock("../../telem/logging", () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
  logIssue: vi.fn(),
}));

describe("withProviderFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the run result when the provider succeeds", async () => {
    const result = await withProviderFallback({
      operation: "test.op",
      fallback: () => "fallback",
      run: async () => "ok",
    });

    expect(result).toBe("ok");
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("logs provider outages as warnings and uses the fallback", async () => {
    const error = new LLMProviderError("budget exceeded");

    const result = await withProviderFallback({
      operation: "search_issues.rewrite",
      fallback: () => "direct",
      run: async () => {
        throw error;
      },
    });

    expect(result).toBe("direct");
    expect(logWarn).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        loggerScope: ["agents", "provider-fallback"],
        contexts: {
          aiProviderFallback: {
            operation: "search_issues.rewrite",
          },
        },
      }),
    );
  });

  it("rethrows unexpected errors", async () => {
    await expect(
      withProviderFallback({
        operation: "test.op",
        fallback: () => "fallback",
        run: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
  });
});
