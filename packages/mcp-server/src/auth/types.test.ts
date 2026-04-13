import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenResponseSchema, toCachedToken } from "./types";

describe("TokenResponseSchema", () => {
  it("accepts upstream token payloads without email validation", () => {
    const token = TokenResponseSchema.parse({
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: "2026-04-13T13:00:00.000Z",
      user: {
        email: "github-sso-user",
        id: "123",
        name: null,
      },
      scope: "org:read",
    });

    expect(token.refresh_token).toBe("refresh-token");
    expect(token.expires_in).toBe(3600);
    expect(token.expires_at).toBe("2026-04-13T13:00:00.000Z");
    expect(token.user.email).toBe("github-sso-user");
  });
});

describe("toCachedToken", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores the upstream absolute expiry and a fallback user label", () => {
    const cached = toCachedToken(
      {
        access_token: "access-token",
        refresh_token: "refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: "2026-04-13T13:00:00.000Z",
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
      refresh_token: "refresh-token",
      expires_at: "2026-04-13T13:00:00.000Z",
      sentry_host: "sentry.io",
      client_id: "client-id",
      user_email: "github-sso-user",
      scope: "org:read",
    });
  });
});
