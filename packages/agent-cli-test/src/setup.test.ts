import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getStdioFixtureAuthCachePath, resolveHarnessSetup } from "./setup.js";

describe("resolveHarnessSetup", () => {
  it("defaults repo setup to the invoking cwd and sentry-dev server", () => {
    expect(
      resolveHarnessSetup({
        setup: "repo",
        defaultCwd: "/tmp/workspace",
      }),
    ).toEqual({
      cwd: "/tmp/workspace",
      serverName: "sentry-dev",
    });
  });

  it("defaults stdio setup to the checked-in fixture project", () => {
    const fixtureDir = fileURLToPath(
      new URL("../projects/stdio", import.meta.url),
    );

    expect(
      resolveHarnessSetup({
        setup: "stdio",
        defaultCwd: "/tmp/workspace",
      }),
    ).toEqual({
      cwd: fixtureDir,
      serverName: "sentry-stdio",
    });
  });

  it("allows overriding cwd and server for stdio setup", () => {
    expect(
      resolveHarnessSetup({
        setup: "stdio",
        defaultCwd: "/tmp/workspace",
        cwd: "./custom",
        server: "my-stdio-server",
      }),
    ).toEqual({
      cwd: path.resolve("./custom"),
      serverName: "my-stdio-server",
    });
  });

  it("returns the checked-in stdio auth cache path", () => {
    const fixtureDir = fileURLToPath(
      new URL("../projects/stdio", import.meta.url),
    );

    expect(getStdioFixtureAuthCachePath()).toEqual(
      path.join(fixtureDir, ".sentry", "mcp.json"),
    );
  });
});
