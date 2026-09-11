/**
 * Unit tests for run-commands spawn options.
 *
 * Kept separate because node:child_process must be mocked before importing
 * the tool module.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RunCommandsPayload } from "../../../../src/lib/init/types.js";

const originalComSpec = process.env.ComSpec;
const originalUppercasePnpmVersionConfig =
  process.env.NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS;
const { spawnCalls } = vi.hoisted(() => ({
  spawnCalls: [] as Array<{
    command: string;
    args: string[];
    options: {
      env?: NodeJS.ProcessEnv;
      shell?: boolean;
      windowsVerbatimArguments?: boolean;
    };
  }>,
}));

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  const { Readable } = await import("node:stream");

  return {
    execFileSync: (_file: string, args: string[]) => {
      const command = args.at(-1);
      if (process.platform !== "win32") {
        return `/usr/local/bin/${command}\n`;
      }
      return command === "pnpm"
        ? "C:\\Tools\\pnpm.CMD\r\n"
        : `C:\\Tools\\${command}.exe\r\n`;
    },
    spawn: (
      command: string,
      args: string[],
      options: {
        env?: NodeJS.ProcessEnv;
        shell?: boolean;
        windowsVerbatimArguments?: boolean;
      }
    ) => {
      spawnCalls.push({ command, args, options });
      const child = new EventEmitter() as any;
      child.stdout = Readable.from(["10.0.0\n"]);
      child.stderr = Readable.from([]);
      child.kill = vi.fn();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    },
  };
});

vi.mock("@sentry/node-core/light", () => ({
  addBreadcrumb: vi.fn(),
}));

import { runCommands } from "../../../../src/lib/init/tools/run-commands.js";

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

function makePayload(command: string): RunCommandsPayload {
  return {
    type: "tool",
    operation: "run-commands",
    cwd: "/tmp",
    params: { commands: [command] },
  };
}

beforeEach(() => {
  spawnCalls.splice(0);
  delete process.env.ComSpec;
  process.env.NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS = "false";
});

afterEach(() => {
  setPlatform(originalPlatform);
  if (originalComSpec === undefined) {
    delete process.env.ComSpec;
  } else {
    process.env.ComSpec = originalComSpec;
  }
  if (originalUppercasePnpmVersionConfig === undefined) {
    delete process.env.NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS;
  } else {
    process.env.NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS =
      originalUppercasePnpmVersionConfig;
  }
});

describe("runCommands spawn options", () => {
  test("uses cmd.exe for package-manager .cmd shims", async () => {
    setPlatform("win32");

    const result = await runCommands(makePayload("pnpm --version"), {
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(spawnCalls[0]).toMatchObject({
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        '""C:\\Tools\\pnpm.CMD" "--config.manage-package-manager-versions=true" "--version""',
      ],
      options: { shell: false, windowsVerbatimArguments: true },
    });
  });

  test("quotes Windows .cmd shim arguments with spaces", async () => {
    setPlatform("win32");

    const result = await runCommands(
      makePayload('pnpm --filter "./apps/web app" add @sentry/nextjs@^8.0.0'),
      { dryRun: false }
    );

    expect(result.ok).toBe(true);
    expect(spawnCalls[0]).toMatchObject({
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        '""C:\\Tools\\pnpm.CMD" "--config.manage-package-manager-versions=true" "--filter" "./apps/web app" "add" "@sentry/nextjs@^8.0.0""',
      ],
      options: { shell: false, windowsVerbatimArguments: true },
    });
  });

  test("doubles trailing backslashes for Windows .cmd shim arguments", async () => {
    setPlatform("win32");

    const result = await runCommands(makePayload("pnpm add C:\\some\\path\\"), {
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(spawnCalls[0]).toMatchObject({
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        '""C:\\Tools\\pnpm.CMD" "--config.manage-package-manager-versions=true" "add" "C:\\some\\path\\\\""',
      ],
      options: { shell: false, windowsVerbatimArguments: true },
    });
  });

  test("doubles embedded quotes for Windows .cmd shim arguments", async () => {
    setPlatform("win32");

    const result = await runCommands(
      makePayload('pnpm add "value \\"quoted\\""'),
      { dryRun: false }
    );

    const commandLine = spawnCalls[0]?.args.at(-1) ?? "";

    expect(result.ok).toBe(true);
    expect(commandLine).toContain(
      '"--config.manage-package-manager-versions=true"'
    );
    expect(commandLine).toContain('"value ""quoted"""');
    expect(commandLine).not.toContain('\\"');
    expect(spawnCalls[0]).toMatchObject({
      command: "cmd.exe",
      options: { shell: false, windowsVerbatimArguments: true },
    });
  });

  test("doubles backslashes before embedded quotes for Windows .cmd shim arguments", async () => {
    setPlatform("win32");

    const result = await runCommands(
      makePayload(String.raw`pnpm add "path\\\"name"`),
      { dryRun: false }
    );

    const commandLine = spawnCalls[0]?.args.at(-1) ?? "";

    expect(result.ok).toBe(true);
    expect(commandLine).toContain(String.raw`"path\\""name"`);
    expect(commandLine).not.toContain(String.raw`"path\""name"`);
    expect(spawnCalls[0]).toMatchObject({
      command: "cmd.exe",
      options: { shell: false, windowsVerbatimArguments: true },
    });
  });

  test("keeps Windows .exe commands shell-free", async () => {
    setPlatform("win32");

    const result = await runCommands(makePayload("dotnet --info"), {
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(spawnCalls[0]).toMatchObject({
      command: "C:\\Tools\\dotnet.exe",
      args: ["--info"],
      options: { shell: false },
    });
    expect(spawnCalls[0]?.options.windowsVerbatimArguments).toBeUndefined();
    expect(spawnCalls[0]?.options.env).toBeUndefined();
  });

  test("keeps POSIX command execution shell-free", async () => {
    setPlatform("darwin");

    const result = await runCommands(makePayload("pnpm --version"), {
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(spawnCalls[0]).toMatchObject({
      command: "/usr/local/bin/pnpm",
      args: ["--config.manage-package-manager-versions=true", "--version"],
      options: { shell: false },
    });
    expect(spawnCalls[0]?.options.windowsVerbatimArguments).toBeUndefined();
    expect(
      spawnCalls[0]?.options.env?.npm_config_manage_package_manager_versions
    ).toBeUndefined();
    expect(
      spawnCalls[0]?.options.env?.NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS
    ).toBeUndefined();
  });

  test.each([
    [
      "python3 -m pip install sentry-sdk",
      "python3",
      ["-m", "pip", "install", "sentry-sdk"],
    ],
    ["uv add sentry-sdk", "uv", ["add", "sentry-sdk"]],
    ["cargo add sentry", "cargo", ["add", "sentry"]],
  ])("does not rewrite non-pnpm package-manager commands: %s", async (command, executableName, expectedArgs) => {
    setPlatform("darwin");

    const result = await runCommands(makePayload(command), {
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(spawnCalls[0]).toMatchObject({
      command: `/usr/local/bin/${executableName}`,
      args: expectedArgs,
      options: { shell: false },
    });
    expect(spawnCalls[0]?.options.env).toBeUndefined();
  });

  test("does not duplicate an explicit pnpm version-management option", async () => {
    setPlatform("darwin");

    const result = await runCommands(
      makePayload(
        "pnpm --config.manage-package-manager-versions=true add @sentry/node"
      ),
      { dryRun: false }
    );

    expect(result.ok).toBe(true);
    expect(spawnCalls[0]?.args).toEqual([
      "--config.manage-package-manager-versions=true",
      "add",
      "@sentry/node",
    ]);
  });
});
