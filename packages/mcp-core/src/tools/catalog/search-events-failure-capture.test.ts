import { describe, expect, it, vi } from "vitest";
import { logWarn } from "../../telem/logging";
import type { ServerContext } from "../../types";
import searchEvents from "./search-events";

vi.mock("../../telem/logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../telem/logging")>();
  return { ...actual, logWarn: vi.fn() };
});

describe("search_events onError", () => {
  it("logs the failing query and cause, scrubbed", () => {
    searchEvents.onError?.(
      new Error("boom"),
      // Unconstrained session: the org is on params, not constraints.
      { query: "errors for jane@acme.com", organizationSlug: "acme" },
      {
        constraints: { organizationSlug: null, projectSlug: null },
      } as ServerContext,
    );

    expect(logWarn).toHaveBeenCalledWith(
      "search_events query failed",
      expect.objectContaining({
        extra: expect.objectContaining({
          errorName: "Error",
          errorMessage: "boom",
          organizationSlug: "acme",
          query: "errors for [REDACTED_EMAIL]",
        }),
      }),
    );
  });
});
