/**
 * Setup Command Tests
 *
 * Tests the `sentry cli setup` command end-to-end through Stricli's run().
 *
 * Status messages go through consola (→ process.stderr). Tests capture stderr
 * via a spy on process.stderr.write and assert on the collected output.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "@stricli/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { app } from "../../../src/app.js";
import type { SentryContext } from "../../../src/context.js";
import { getReleaseChannel } from "../../../src/lib/db/release-channel.js";
import { useTestConfigDir } from "../../helpers.js";

/** Store original fetch for restoration */
let originalFetch: typeof globalThis.fetch;

/** Helper to mock fetch without TypeScript errors about missing Bun-specific properties */
function mockFetch(
  fn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>
): void {
  globalThis.fetch = fn as typeof globalThis.fetch;
}

/**
 * Create a mock Stricli context and a stderr capture for consola output.
 *
 * The context provides process/env stubs for the setup command, while
 * `getOutput()` returns the combined consola output captured from
 * `process.stderr.write` (where consola routes all messages).
 */
function createMockContext(
  overrides: Partial<{
    homeDir: string;
    env: Record<string, string | undefined>;
    execPath: string;
  }> = {}
): {
  context: SentryContext;
  getOutput: () => string;
  clearOutput: () => void;
  restore: () => void;
} {
  const stderrChunks: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  const env: Record<string, string | undefined> = {
    PATH: "/usr/bin:/bin",
    SHELL: "/bin/bash",
    ...overrides.env,
  };

  const stdoutChunks: string[] = [];
  const context = {
    process: {
      stdout: {
        write: vi.fn((s: string) => {
          stdoutChunks.push(String(s));
          return true;
        }),
      },
      stderr: {
        write: vi.fn((_s: string) => true),
      },
      stdin: process.stdin,
      env,
      cwd: () => "/tmp",
      execPath: overrides.execPath ?? "/usr/local/bin/sentry",
      exit: vi.fn(() => {
        // no-op for tests
      }),
      exitCode: 0,
    },
    homeDir: overrides.homeDir ?? "/tmp/test-home",
    cwd: "/tmp",
    configDir: "/tmp/test-config",
    env,
    stdout: {
      write: vi.fn((s: string) => {
        stdoutChunks.push(String(s));
        return true;
      }),
    },
    stderr: {
      write: vi.fn((_s: string) => true),
    },
    stdin: process.stdin,
    setFlags: () => {
      // no-op for tests
    },
  } as unknown as SentryContext;

  return {
    context,
    getOutput: () => stdoutChunks.join("") + stderrChunks.join(""),
    clearOutput: () => {
      stdoutChunks.length = 0;
      stderrChunks.length = 0;
    },
    restore: () => {
      process.stderr.write = origWrite;
    },
  };
}

describe("sentry cli setup", () => {
  let testDir: string;
  let restoreStderr: (() => void) | undefined;

  beforeEach(() => {
    testDir = join(
      "/tmp",
      `setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    restoreStderr?.();
    restoreStderr = undefined;
    rmSync(testDir, { recursive: true, force: true });
  });

  test("runs with --quiet and skips all output", async () => {
    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
    });
    restoreStderr = restore;

    await run(
      app,
      [
        "cli",
        "setup",
        "--quiet",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
      ],
      context
    );

    // With --quiet, no output should be produced
    expect(getOutput()).toBe("");
  });

  test("produces no welcome or completion output without --install", async () => {
    // Without --install, setup is being called for an upgrade or manual re-run.
    // Output is suppressed — the upgrade command itself prints success.
    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
    });
    restoreStderr = restore;

    await run(
      app,
      [
        "cli",
        "setup",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
      ],
      context
    );

    expect(getOutput()).toBe("");
  });

  test("records install method when --method is provided", async () => {
    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
    });
    restoreStderr = restore;

    await run(
      app,
      [
        "cli",
        "setup",
        "--method",
        "curl",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
      ],
      context
    );

    expect(getOutput()).toContain("Recorded installation method: curl");
  });

  test("handles PATH modification when binary not in PATH", async () => {
    // Create a .bashrc for the shell config to find
    const bashrc = join(testDir, ".bashrc");
    writeFileSync(bashrc, "# existing config\n");

    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
      execPath: join(testDir, "bin", "sentry"),
      env: {
        PATH: "/usr/bin:/bin",
        SHELL: "/bin/bash",
      },
    });
    restoreStderr = restore;

    await run(
      app,
      ["cli", "setup", "--no-completions", "--no-agent-skills"],
      context
    );

    expect(getOutput()).toContain("PATH:");
  });

  test("reports PATH already configured when binary dir is in PATH", async () => {
    const binDir = join(testDir, "bin");
    mkdirSync(binDir, { recursive: true });

    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
      execPath: join(binDir, "sentry"),
      env: {
        PATH: `/usr/bin:${binDir}:/bin`,
        SHELL: "/bin/bash",
      },
    });
    restoreStderr = restore;

    await run(
      app,
      ["cli", "setup", "--no-completions", "--no-agent-skills"],
      context
    );

    expect(getOutput()).toContain("already in PATH");
  });

  test("reports no config file found for unknown shell", async () => {
    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
      env: {
        PATH: "/usr/bin:/bin",
        SHELL: "/bin/tcsh",
      },
    });
    restoreStderr = restore;

    await run(
      app,
      ["cli", "setup", "--no-completions", "--no-agent-skills"],
      context
    );

    expect(getOutput()).toContain("No shell config file found");
    expect(getOutput()).toContain("Add manually");
  });

  test("installs completions when not skipped", async () => {
    const bashrc = join(testDir, ".bashrc");
    writeFileSync(bashrc, "# existing\n");

    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
      execPath: join(testDir, "bin", "sentry"),
      env: {
        PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
        SHELL: "/bin/bash",
      },
    });
    restoreStderr = restore;

    await run(
      app,
      ["cli", "setup", "--no-modify-path", "--no-agent-skills"],
      context
    );

    expect(getOutput()).toContain("Completions:");
  });

  test("adds fpath to .zshrc for zsh completions", async () => {
    const zshrc = join(testDir, ".zshrc");
    writeFileSync(zshrc, "# existing zshrc\n");

    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
      execPath: join(testDir, "bin", "sentry"),
      env: {
        PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
        SHELL: "/bin/zsh",
      },
    });
    restoreStderr = restore;

    await run(
      app,
      ["cli", "setup", "--no-modify-path", "--no-agent-skills"],
      context
    );

    expect(getOutput()).toContain("fpath");
    expect(getOutput()).toContain("Completions:");

    // Verify .zshrc was actually modified
    const content = await readFile(zshrc, "utf-8");
    expect(content).toContain("fpath=");
    expect(content).toContain("site-functions");
  });

  test("skips fpath modification when already configured in .zshrc", async () => {
    const zshrc = join(testDir, ".zshrc");
    const completionDir = join(
      testDir,
      ".local",
      "share",
      "zsh",
      "site-functions"
    );
    writeFileSync(zshrc, `# existing\nfpath=("${completionDir}" $fpath)\n`);

    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
      execPath: join(testDir, "bin", "sentry"),
      env: {
        PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
        SHELL: "/bin/zsh",
      },
    });
    restoreStderr = restore;

    await run(
      app,
      ["cli", "setup", "--no-modify-path", "--no-agent-skills"],
      context
    );

    // Should still show "Installed to" but not "Added ... to fpath"
    const output = getOutput();
    expect(output).toContain("Completions: Installed to");
    expect(output).not.toContain("Added sentry fpath in");
  });

  test("handles GitHub Actions PATH when GITHUB_ACTIONS is set", async () => {
    const ghPathFile = join(testDir, "github_path");
    writeFileSync(ghPathFile, "");

    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
      execPath: join(testDir, "bin", "sentry"),
      env: {
        PATH: "/usr/bin:/bin",
        SHELL: "/bin/bash",
        GITHUB_ACTIONS: "true",
        GITHUB_PATH: ghPathFile,
      },
    });
    restoreStderr = restore;

    await run(
      app,
      ["cli", "setup", "--no-completions", "--no-agent-skills"],
      context
    );

    expect(getOutput()).toContain("GITHUB_PATH");
  });

  test("falls back to bash completions for unsupported shell when bash is available", async () => {
    // Create a fake bash executable in testDir/bin so isBashAvailable() returns
    // true with PATH pointing there — no dependency on the host system.
    const binDir = join(testDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const { chmodSync, writeFileSync: wf } = await import("node:fs");
    const fakeBash = join(binDir, "bash");
    wf(fakeBash, "#!/bin/sh\necho fake-bash");
    chmodSync(fakeBash, 0o755);

    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
      execPath: join(testDir, "bin", "sentry"),
      env: {
        PATH: binDir,
        SHELL: "/bin/xonsh",
      },
    });
    restoreStderr = restore;

    await run(
      app,
      ["cli", "setup", "--no-modify-path", "--no-agent-skills"],
      context
    );

    expect(getOutput()).toContain(
      "Your shell (xonsh) is not directly supported"
    );
    expect(getOutput()).toContain("bash completions as a fallback");
    expect(getOutput()).toContain("bash-completion");
  });

  test("silently skips completions for unsupported shell when bash is not in PATH", async () => {
    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
      execPath: join(testDir, "bin", "sentry"),
      env: {
        // Empty PATH so isBashAvailable() returns false
        PATH: "",
        SHELL: "/bin/xonsh",
      },
    });
    restoreStderr = restore;

    await run(
      app,
      ["cli", "setup", "--no-modify-path", "--no-agent-skills"],
      context
    );

    // Nothing actionable — no message produced
    expect(getOutput()).not.toContain("Completions:");
    expect(getOutput()).not.toContain("Not supported");
  });

  test("suppresses completion messages on subsequent runs (upgrade scenario)", async () => {
    const { context, getOutput, clearOutput, restore } = createMockContext({
      homeDir: testDir,
      execPath: join(testDir, "bin", "sentry"),
      env: {
        PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
        SHELL: "/bin/bash",
      },
    });
    restoreStderr = restore;

    // First run — should show "Installed to"
    await run(
      app,
      ["cli", "setup", "--no-modify-path", "--no-agent-skills"],
      context
    );

    expect(getOutput()).toContain("Completions: Installed to");

    // Second run — completion file already exists, should be silent
    clearOutput();
    await run(
      app,
      ["cli", "setup", "--no-modify-path", "--no-agent-skills"],
      context
    );

    expect(getOutput()).not.toContain("Completions:");
  });

  test("silently skips completions for sh shell", async () => {
    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
      execPath: join(testDir, "bin", "sentry"),
      env: {
        PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
        SHELL: "/bin/sh",
      },
    });
    restoreStderr = restore;

    await run(
      app,
      ["cli", "setup", "--no-modify-path", "--no-agent-skills"],
      context
    );

    // sh/ash shells silently skip completions — no message at all
    expect(getOutput()).not.toContain("Completions:");
  });

  test("supports kebab-case flags", async () => {
    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
    });
    restoreStderr = restore;

    // Verify kebab-case works (--no-modify-path instead of --noModifyPath)
    await run(
      app,
      [
        "cli",
        "setup",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
        "--quiet",
      ],
      context
    );

    // Should not error
    expect(getOutput()).toBe("");
  });

  describe("--install flag", () => {
    test("installs binary from temp location and shows welcome message", async () => {
      // Create a fake source binary to "install"
      const sourceDir = join(testDir, "tmp");
      mkdirSync(sourceDir, { recursive: true });
      const sourcePath = join(sourceDir, "sentry-download");
      writeFileSync(sourcePath, "#!/bin/sh\necho test-binary");
      const { chmodSync } = await import("node:fs");
      chmodSync(sourcePath, 0o755);

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
        execPath: sourcePath,
        env: {
          PATH: "/usr/bin:/bin",
          SHELL: "/bin/bash",
          SENTRY_INSTALL_DIR: join(testDir, "install-dir"),
        },
      });
      restoreStderr = restore;

      await run(
        app,
        [
          "cli",
          "setup",
          "--install",
          "--method",
          "curl",
          "--no-modify-path",
          "--no-completions",
          "--no-agent-skills",
        ],
        context
      );

      const combined = getOutput();

      // Should show welcome message, not "Setup complete!"
      expect(combined).toContain("Installed sentry v");
      expect(combined).toContain("Get started:");
      expect(combined).toContain("sentry auth login");
      expect(combined).toContain("sentry --help");
      expect(combined).toContain("cli.sentry.dev");
      expect(combined).not.toContain("Setup complete!");

      // Should install binary to the target directory
      const installedPath = join(testDir, "install-dir", "sentry");
      expect(existsSync(installedPath)).toBe(true);
    });

    test("does not log 'Recorded installation method' with --install", async () => {
      const sourceDir = join(testDir, "tmp");
      mkdirSync(sourceDir, { recursive: true });
      const sourcePath = join(sourceDir, "sentry-download");
      writeFileSync(sourcePath, "binary-content");
      const { chmodSync } = await import("node:fs");
      chmodSync(sourcePath, 0o755);

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
        execPath: sourcePath,
        env: {
          PATH: "/usr/bin:/bin",
          SHELL: "/bin/bash",
          SENTRY_INSTALL_DIR: join(testDir, "install-dir"),
        },
      });
      restoreStderr = restore;

      await run(
        app,
        [
          "cli",
          "setup",
          "--install",
          "--method",
          "curl",
          "--no-modify-path",
          "--no-completions",
          "--no-agent-skills",
        ],
        context
      );

      // With --install, the "Recorded installation method" log is suppressed
      expect(getOutput()).not.toContain("Recorded installation method");
    });

    test("--install suppresses welcome when binary already exists (upgrade)", async () => {
      const installDir = join(testDir, "install-dir");
      mkdirSync(installDir, { recursive: true });
      // Pre-existing binary — this is an upgrade, not a fresh install
      writeFileSync(join(installDir, "sentry"), "old-binary");

      const sourceDir = join(testDir, "tmp");
      mkdirSync(sourceDir, { recursive: true });
      const sourcePath = join(sourceDir, "sentry-download");
      writeFileSync(sourcePath, "new-binary");
      const { chmodSync } = await import("node:fs");
      chmodSync(sourcePath, 0o755);

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
        execPath: sourcePath,
        env: {
          PATH: "/usr/bin:/bin",
          SHELL: "/bin/bash",
          SENTRY_INSTALL_DIR: installDir,
        },
      });
      restoreStderr = restore;

      await run(
        app,
        [
          "cli",
          "setup",
          "--install",
          "--method",
          "curl",
          "--no-modify-path",
          "--no-completions",
          "--no-agent-skills",
        ],
        context
      );

      const combined = getOutput();

      // Binary placement is still logged
      expect(combined).toContain("Binary: Installed to");
      // But welcome/getting-started is suppressed for upgrades
      expect(combined).not.toContain("Get started:");
      expect(combined).not.toContain("sentry auth login");
    });

    test("--install with --quiet suppresses all output", async () => {
      const sourceDir = join(testDir, "tmp");
      mkdirSync(sourceDir, { recursive: true });
      const sourcePath = join(sourceDir, "sentry-download");
      writeFileSync(sourcePath, "binary-content");
      const { chmodSync } = await import("node:fs");
      chmodSync(sourcePath, 0o755);

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
        execPath: sourcePath,
        env: {
          PATH: "/usr/bin:/bin",
          SHELL: "/bin/bash",
          SENTRY_INSTALL_DIR: join(testDir, "install-dir"),
        },
      });
      restoreStderr = restore;

      await run(
        app,
        [
          "cli",
          "setup",
          "--install",
          "--method",
          "curl",
          "--no-modify-path",
          "--no-completions",
          "--no-agent-skills",
          "--quiet",
        ],
        context
      );

      expect(getOutput()).toBe("");
    });
  });

  describe("agent skills", () => {
    beforeEach(() => {
      originalFetch = globalThis.fetch;
      mockFetch(
        async () =>
          new Response("# Sentry CLI Skill\nTest content", { status: 200 })
      );
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("installs agent skills when Claude Code is detected", async () => {
      // Create ~/.claude to simulate Claude Code being installed
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
        execPath: join(testDir, "bin", "sentry"),
        env: {
          PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
          SHELL: "/bin/bash",
        },
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "setup", "--no-modify-path", "--no-completions"],
        context
      );

      expect(getOutput()).toContain("Agent skills:");
      expect(getOutput()).toContain("Installed to");

      // Verify the file was actually written
      const skillPath = join(
        testDir,
        ".claude",
        "skills",
        "sentry-cli",
        "SKILL.md"
      );
      expect(existsSync(skillPath)).toBe(true);
    });

    test("silently skips when no supported agent root is detected", async () => {
      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
        execPath: join(testDir, "bin", "sentry"),
        env: {
          PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
          SHELL: "/bin/bash",
        },
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "setup", "--no-modify-path", "--no-completions"],
        context
      );

      expect(getOutput()).not.toContain("Agent skills:");
    });

    test("installs to ~/.agents/ when the shared agent root is detected", async () => {
      mkdirSync(join(testDir, ".agents"), { recursive: true });

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
        execPath: join(testDir, "bin", "sentry"),
        env: {
          PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
          SHELL: "/bin/bash",
        },
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "setup", "--no-modify-path", "--no-completions"],
        context
      );

      expect(getOutput()).toContain("Agent skills: Installed to");
      expect(
        existsSync(join(testDir, ".agents", "skills", "sentry-cli", "SKILL.md"))
      ).toBe(true);
      expect(
        existsSync(join(testDir, ".claude", "skills", "sentry-cli", "SKILL.md"))
      ).toBe(false);
    });

    test("suppresses agent skills message on subsequent runs (upgrade scenario)", async () => {
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const { context, getOutput, clearOutput, restore } = createMockContext({
        homeDir: testDir,
        execPath: join(testDir, "bin", "sentry"),
        env: {
          PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
          SHELL: "/bin/bash",
        },
      });
      restoreStderr = restore;

      // First run — should show "Installed to"
      await run(
        app,
        ["cli", "setup", "--no-modify-path", "--no-completions"],
        context
      );

      expect(getOutput()).toContain("Agent skills: Installed to");

      // Second run — skill file already exists, should be silent
      clearOutput();
      await run(
        app,
        ["cli", "setup", "--no-modify-path", "--no-completions"],
        context
      );

      expect(getOutput()).not.toContain("Agent skills:");
    });

    test("skips when --no-agent-skills is set", async () => {
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
        execPath: join(testDir, "bin", "sentry"),
        env: {
          PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
          SHELL: "/bin/bash",
        },
      });
      restoreStderr = restore;

      await run(
        app,
        [
          "cli",
          "setup",
          "--no-modify-path",
          "--no-completions",
          "--no-agent-skills",
        ],
        context
      );

      expect(getOutput()).not.toContain("Agent skills:");
    });

    test("installs embedded skill files when Claude Code is detected", async () => {
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
        execPath: join(testDir, "bin", "sentry"),
        env: {
          PATH: `/usr/bin:${join(testDir, "bin")}:/bin`,
          SHELL: "/bin/bash",
        },
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "setup", "--no-modify-path", "--no-completions"],
        context
      );

      // Skill files are embedded at build time, so installation should succeed
      expect(getOutput()).toContain("Agent skills:");
    });

    test("setup completes gracefully when completion directory is not writable", async () => {
      // Make the completions dir unwritable so write() can't write the
      // completion script. installCompletions() catches the permission error
      // and returns null — setup completes without error or warning.
      const { chmodSync: chmod } = await import("node:fs");
      const homeDir = join(testDir, "home");
      const xdgData = join(homeDir, ".local", "share");
      mkdirSync(xdgData, { recursive: true });
      // Create the zsh site-functions dir as unwritable so Bun.write() fails
      const zshDir = join(xdgData, "zsh", "site-functions");
      mkdirSync(zshDir, { recursive: true });
      chmod(zshDir, 0o444); // read-only → completion write will throw

      const { context, getOutput, restore } = createMockContext({
        homeDir,
        env: {
          XDG_DATA_HOME: xdgData,
          PATH: "/usr/bin:/bin",
          SHELL: "/bin/zsh",
        },
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "setup", "--no-modify-path", "--no-agent-skills"],
        context
      );

      const combined = getOutput();
      // installCompletions handles permission errors gracefully and returns
      // null, so bestEffort never sees an error — no failure message appears
      expect(combined).not.toContain("Shell completions failed");
      // No misleading fallback message for a supported shell (zsh)
      expect(combined).not.toContain("not directly supported");
      // Setup still completes successfully
      expect(combined).not.toContain("error");

      chmod(zshDir, 0o755);
    });
  });
});

describe("sentry cli setup — --channel flag", () => {
  useTestConfigDir("test-setup-channel-");

  let testDir: string;
  let restoreStderr: (() => void) | undefined;

  beforeEach(() => {
    testDir = join(
      "/tmp",
      `setup-channel-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    restoreStderr?.();
    restoreStderr = undefined;
    rmSync(testDir, { recursive: true, force: true });
  });

  test("persists 'nightly' channel when --channel nightly is passed", async () => {
    const { context, restore } = createMockContext({ homeDir: testDir });
    restoreStderr = restore;

    expect(getReleaseChannel()).toBe("stable");

    await run(
      app,
      [
        "cli",
        "setup",
        "--channel",
        "nightly",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
      ],
      context
    );

    expect(getReleaseChannel()).toBe("nightly");
  });

  test("persists 'stable' channel when --channel stable is passed", async () => {
    const { context, restore } = createMockContext({ homeDir: testDir });
    restoreStderr = restore;

    await run(
      app,
      [
        "cli",
        "setup",
        "--channel",
        "stable",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
      ],
      context
    );

    expect(getReleaseChannel()).toBe("stable");
  });

  test("logs channel when not in --install mode", async () => {
    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
    });
    restoreStderr = restore;

    await run(
      app,
      [
        "cli",
        "setup",
        "--channel",
        "nightly",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
      ],
      context
    );

    expect(getOutput()).toContain("Recorded release channel: nightly");
  });

  test("does not log channel in --install mode", async () => {
    // In --install mode, the setup is silent about the channel
    // (it's set during binary placement, before user sees output)
    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
      execPath: join(testDir, "sentry.download"),
    });
    restoreStderr = restore;

    await run(
      app,
      [
        "cli",
        "setup",
        "--install",
        "--channel",
        "nightly",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
      ],
      context
    );

    expect(getOutput()).not.toContain("Recorded release channel: nightly");
  });
});
