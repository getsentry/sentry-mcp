import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSentryUserFromRequest } from "./sentry-user";

const { setUser } = vi.hoisted(() => ({
  setUser: vi.fn(),
}));

vi.mock("@sentry/cloudflare", () => ({
  setUser,
}));

describe("setSentryUserFromRequest", () => {
  beforeEach(() => {
    setUser.mockReset();
  });

  it("sets user ID and IP address in the same Sentry user context", () => {
    const user = setSentryUserFromRequest(
      new Request("https://mcp.sentry.dev/mcp", {
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
        },
      }),
      "user-123",
    );

    expect(user).toEqual({
      id: "user-123",
      ip_address: "192.0.2.1",
    });
    expect(setUser).toHaveBeenCalledWith({
      id: "user-123",
      ip_address: "192.0.2.1",
    });
  });
});
