import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerContext } from "../../types";
import { resolveRegionUrlForOrganization } from "./resolve-region-url";

const { getOrganization } = vi.hoisted(() => ({
  getOrganization: vi.fn(),
}));

vi.mock("./api", () => ({
  apiServiceFromContext: vi.fn(() => ({
    getOrganization,
  })),
}));

function createContext(
  constraints: ServerContext["constraints"] = {},
): ServerContext {
  return {
    accessToken: "test-access-token",
    constraints,
  };
}

describe("resolveRegionUrlForOrganization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an explicit regionUrl without fetching the organization", async () => {
    const result = await resolveRegionUrlForOrganization({
      context: createContext(),
      organizationSlug: "my-org",
      regionUrl: " https://de.sentry.io ",
    });

    expect(result).toBe("https://de.sentry.io");
    expect(getOrganization).not.toHaveBeenCalled();
  });

  it("returns the scoped regionUrl from context without fetching the organization", async () => {
    const result = await resolveRegionUrlForOrganization({
      context: createContext({
        organizationSlug: "my-org",
        regionUrl: " https://us.sentry.io ",
      }),
      organizationSlug: "my-org",
      regionUrl: null,
    });

    expect(result).toBe("https://us.sentry.io");
    expect(getOrganization).not.toHaveBeenCalled();
  });

  it("caches fetched region URLs per context", async () => {
    getOrganization.mockResolvedValue({
      links: {
        regionUrl: " https://us.sentry.io ",
      },
    });

    const context = createContext();

    const first = await resolveRegionUrlForOrganization({
      context,
      organizationSlug: "my-org",
      regionUrl: null,
    });
    const second = await resolveRegionUrlForOrganization({
      context,
      organizationSlug: "my-org",
      regionUrl: null,
    });

    expect(first).toBe("https://us.sentry.io");
    expect(second).toBe("https://us.sentry.io");
    expect(getOrganization).toHaveBeenCalledOnce();
    expect(getOrganization).toHaveBeenCalledWith("my-org");
  });

  it("caches empty region URLs after a successful organization lookup", async () => {
    getOrganization.mockResolvedValue({
      links: {
        regionUrl: "",
      },
    });

    const context = createContext();

    const first = await resolveRegionUrlForOrganization({
      context,
      organizationSlug: "self-hosted-org",
      regionUrl: null,
    });
    const second = await resolveRegionUrlForOrganization({
      context,
      organizationSlug: "self-hosted-org",
      regionUrl: null,
    });

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(getOrganization).toHaveBeenCalledOnce();
    expect(getOrganization).toHaveBeenCalledWith("self-hosted-org");
  });
});
