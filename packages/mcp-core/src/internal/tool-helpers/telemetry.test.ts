import { beforeEach, describe, expect, it, vi } from "vitest";
import { setOrganizationSlug } from "./telemetry";

const { getActiveSpan, setAttribute, setTag } = vi.hoisted(() => ({
  getActiveSpan: vi.fn(),
  setAttribute: vi.fn(),
  setTag: vi.fn(),
}));

vi.mock("@sentry/core", () => ({
  getActiveSpan,
  setTag,
}));

describe("setOrganizationSlug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveSpan.mockReturnValue({ setAttribute });
  });

  it("sets the organization tag and span attribute", () => {
    setOrganizationSlug("acme");

    expect(setTag).toHaveBeenCalledWith("organization.slug", "acme");
    expect(setAttribute).toHaveBeenCalledWith("app.organization.slug", "acme");
  });

  it("still sets the tag without an active span", () => {
    getActiveSpan.mockReturnValue(undefined);

    setOrganizationSlug("acme");

    expect(setTag).toHaveBeenCalledWith("organization.slug", "acme");
    expect(setAttribute).not.toHaveBeenCalled();
  });
});
