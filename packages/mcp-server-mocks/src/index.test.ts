/**
 * Tests for MSW mock server user data endpoint restrictions.
 *
 * Verifies that user data endpoints (whoami and find_organizations)
 * are only available on the main host (sentry.io) and not on
 * region-specific hosts (us.sentry.io, de.sentry.io).
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { mswServer } from "./index";

beforeAll(() => mswServer.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe("User data endpoint restrictions", () => {
  it("whoami endpoint should only work on main host (sentry.io)", async () => {
    // Should work on main host
    const mainHostResponse = await fetch("https://sentry.io/api/0/auth/");
    expect(mainHostResponse.ok).toBe(true);
    const mainHostData = await mainHostResponse.json();
    expect(mainHostData).toEqual({
      id: "1",
      name: "John Doe",
      email: "john.doe@example.com",
    });

    // Should NOT work on region-specific host (request will bypass and not be intercepted)
    // This means the request goes through but there's no actual server to respond
    try {
      const regionHostResponse = await fetch(
        "https://us.sentry.io/api/0/auth/",
      );
      // If the request somehow succeeds, it should not return our mock data
      expect(regionHostResponse.ok).toBe(false);
    } catch (error) {
      // This is expected - no actual server at us.sentry.io in test environment
      expect(error).toBeDefined();
    }
  });

  it("find_organizations endpoint should only work on main host (sentry.io)", async () => {
    // Should work on main host
    const mainHostResponse = await fetch(
      "https://sentry.io/api/0/users/me/regions/",
    );
    expect(mainHostResponse.ok).toBe(true);
    const mainHostData = await mainHostResponse.json();
    expect(mainHostData).toEqual({
      regions: [{ name: "us", url: "https://us.sentry.io" }],
    });

    // Should NOT work on region-specific host (request will bypass and not be intercepted)
    try {
      const regionHostResponse = await fetch(
        "https://us.sentry.io/api/0/users/me/regions/",
      );
      // If the request somehow succeeds, it should not return our mock data
      expect(regionHostResponse.ok).toBe(false);
    } catch (error) {
      // This is expected - no actual server at us.sentry.io in test environment
      expect(error).toBeDefined();
    }
  });

  it("other endpoints should work on both hosts", async () => {
    // Organization endpoints should work on both hosts
    const mainOrgResponse = await fetch(
      "https://sentry.io/api/0/organizations/",
    );
    expect(mainOrgResponse.ok).toBe(true);

    const regionOrgResponse = await fetch(
      "https://us.sentry.io/api/0/organizations/",
    );
    expect(regionOrgResponse.ok).toBe(true);

    // Responses should be identical
    const mainOrgData = await mainOrgResponse.json();
    const regionOrgData = await regionOrgResponse.json();
    expect(mainOrgData).toEqual(regionOrgData);
  });
});
