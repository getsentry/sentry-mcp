import { describe, expect, it } from "vitest";
import {
  buildStdioServerLaunchConfig,
  resolveTransportMode,
} from "./transport.js";

describe("resolveTransportMode", () => {
  it("defaults to stdio when auto mode has an access token", () => {
    expect(
      resolveTransportMode({
        requestedTransport: "auto",
        accessToken: "token-123",
      }),
    ).toBe("stdio");
  });

  it("defaults to http when auto mode has no access token", () => {
    expect(
      resolveTransportMode({
        requestedTransport: "auto",
      }),
    ).toBe("http");
  });

  it("honors explicit stdio without an access token", () => {
    expect(
      resolveTransportMode({
        requestedTransport: "stdio",
      }),
    ).toBe("stdio");
  });
});

describe("buildStdioServerLaunchConfig", () => {
  it("omits token settings when no access token is provided", () => {
    const launchConfig = buildStdioServerLaunchConfig(
      {
        host: "sentry.io",
      },
      {
        PATH: "/usr/bin",
        HOME: "/tmp/home",
      },
    );

    expect(launchConfig.args).toEqual(["--host=sentry.io"]);
    expect(launchConfig.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      SENTRY_HOST: "sentry.io",
    });
  });

  it("includes token and optional flags when provided", () => {
    const launchConfig = buildStdioServerLaunchConfig(
      {
        accessToken: "token-123",
        host: "us.sentry.io",
        sentryDsn: "https://dsn.example/1",
        useAgentEndpoint: true,
        useExperimental: true,
      },
      {
        PATH: "/usr/bin",
      },
    );

    expect(launchConfig.args).toEqual([
      "--access-token=token-123",
      "--host=us.sentry.io",
      "--sentry-dsn=https://dsn.example/1",
      "--agent",
      "--experimental",
    ]);
    expect(launchConfig.env).toEqual({
      PATH: "/usr/bin",
      SENTRY_ACCESS_TOKEN: "token-123",
      SENTRY_HOST: "us.sentry.io",
      SENTRY_DSN: "https://dsn.example/1",
    });
  });
});
