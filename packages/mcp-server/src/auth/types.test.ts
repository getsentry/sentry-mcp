import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenResponseSchema, toCachedToken } from "./types";

describe("TokenResponseSchema", () => {
  it("accepts upstream token payloads without email validation or refresh metadata", () => {
    const token = TokenResponseSchema.parse({
      access_token: "access-token",
      refresh_token: null,
      token_type: "bearer",
      expires_in: null,
      expires_at: null,
      user: {
        email: "github-sso-user",
        id: "123",
        name: null,
      },
      scope: "org:read",
    });

    expect(token.refresh_token).toBeNull();
    expect(token.expires_in).toBeNull();
    expect(token.expires_at).toBeNull();
    expect(token.user.email).toBe("github-sso-user");
  });
});

describe("toCachedToken", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives expires_at from expires_in when upstream omits an absolute expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T12:00:00.000Z"));

    const cached = toCachedToken(
      {
        access_token: "access-token",
        refresh_token: null,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: null,
        user: {
          email: "github-sso-user",
          id: "123",
          name: null,
        },
        scope: "org:read",
      },
      "sentry.io",
      "client-id",
    );

    expect(cached).toEqual({
      access_token: "access-token",
      refresh_token: null,
      expires_at: "2026-04-13T13:00:00.000Z",
      sentry_host: "sentry.io",
      client_id: "client-id",
      user_email: "github-sso-user",
      scope: "org:read",
    });
  });

  it("returns null when upstream provides no expiry metadata at all", () => {
    const cached = toCachedToken(
      {
        access_token: "access-token",
        refresh_token: null,
        token_type: "bearer",
        expires_in: null,
        expires_at: null,
        user: {
          email: null,
          id: "123",
          name: "Test User",
        },
        scope: "org:read",
      },
      "sentry.io",
      "client-id",
    );

    expect(cached).toBeNull();
  });
});
