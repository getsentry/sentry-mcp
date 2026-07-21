import { describe, expect, it } from "vitest";
import {
  defaultOAuthRedirectUri,
  isLoopbackHost,
  resolveOAuthRedirect,
} from "./redirect.js";

describe("resolveOAuthRedirect", () => {
  it("defaults to the loopback callback server", () => {
    expect(resolveOAuthRedirect({})).toEqual({
      port: 8765,
      host: "127.0.0.1",
      redirectUri: "http://localhost:8765/callback",
    });
  });

  it("derives the redirect URI from MCP_OAUTH_PORT", () => {
    expect(resolveOAuthRedirect({ MCP_OAUTH_PORT: "9000" })).toEqual({
      port: 9000,
      host: "127.0.0.1",
      redirectUri: "http://localhost:9000/callback",
    });
  });

  it("binds to MCP_OAUTH_HOST so the callback is reachable from a host browser", () => {
    expect(resolveOAuthRedirect({ MCP_OAUTH_HOST: "0.0.0.0" }).host).toBe(
      "0.0.0.0",
    );
  });

  it("uses MCP_OAUTH_REDIRECT_URI verbatim", () => {
    const redirect = resolveOAuthRedirect({
      MCP_OAUTH_REDIRECT_URI: "http://192.168.1.20:8765/callback",
    });

    expect(redirect.redirectUri).toBe("http://192.168.1.20:8765/callback");
    expect(redirect.port).toBe(8765);
  });

  it("keeps an explicit redirect URI independent of the listen port", () => {
    const redirect = resolveOAuthRedirect({
      MCP_OAUTH_PORT: "9000",
      MCP_OAUTH_REDIRECT_URI: "http://host.docker.internal:8765/callback",
    });

    expect(redirect.port).toBe(9000);
    expect(redirect.redirectUri).toBe(
      "http://host.docker.internal:8765/callback",
    );
  });

  it.each(["", "   "])("ignores blank overrides (%j)", (value) => {
    expect(
      resolveOAuthRedirect({
        MCP_OAUTH_PORT: value,
        MCP_OAUTH_HOST: value,
        MCP_OAUTH_REDIRECT_URI: value,
      }),
    ).toEqual({
      port: 8765,
      host: "127.0.0.1",
      redirectUri: "http://localhost:8765/callback",
    });
  });

  it.each(["not-a-port", "8765.5", "-1", "70000", "0", "0x1F90", "1e4"])(
    "rejects invalid MCP_OAUTH_PORT (%s)",
    (value) => {
      expect(() => resolveOAuthRedirect({ MCP_OAUTH_PORT: value })).toThrow(
        /MCP_OAUTH_PORT/,
      );
    },
  );

  it.each(["javascript:alert(1)", "file:///etc/passwd"])(
    "rejects a non-http MCP_OAUTH_REDIRECT_URI (%s)",
    (value) => {
      expect(() =>
        resolveOAuthRedirect({ MCP_OAUTH_REDIRECT_URI: value }),
      ).toThrow(/http or https/);
    },
  );

  it("rejects a relative MCP_OAUTH_REDIRECT_URI", () => {
    expect(() =>
      resolveOAuthRedirect({ MCP_OAUTH_REDIRECT_URI: "/callback" }),
    ).toThrow(/absolute URL/);
  });

  it("rejects a redirect URI containing userinfo", () => {
    expect(() =>
      resolveOAuthRedirect({
        MCP_OAUTH_REDIRECT_URI: "http://mcp.sentry.dev@evil.example/callback",
      }),
    ).toThrow(/userinfo/);
  });

  it("matches the default resolution", () => {
    expect(defaultOAuthRedirectUri()).toBe(
      resolveOAuthRedirect({}).redirectUri,
    );
  });
});

describe("isLoopbackHost", () => {
  it.each(["127.0.0.1", "::1", "localhost"])(
    "treats %s as loopback",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(["0.0.0.0", "192.168.1.20"])("treats %s as reachable", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});
