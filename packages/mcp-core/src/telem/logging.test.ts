import { describe, expect, it, vi, afterEach } from "vitest";

describe("logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("routes structured info logs to stderr instead of stdout", async () => {
    vi.resetModules();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { logInfo } = await import("./logging");

    logInfo("No issues found for query: is:unresolved", {
      extra: {
        query: "is:unresolved",
        organizationSlug: "org",
      },
    });

    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);

    const [payload] = error.mock.calls[0];
    expect(typeof payload).toBe("string");
    expect(JSON.parse(payload as string)).toMatchObject({
      level: "INFO",
      message: "No issues found for query: is:unresolved",
      logger: "sentry.mcp",
      properties: {
        severity: "info",
        query: "is:unresolved",
        organizationSlug: "org",
      },
    });
  });
});
