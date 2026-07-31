/**
 * Upgrade Command Tests
 *
 * Tests the `sentry cli upgrade` command through Stricli's run().
 * Covers resolveTargetVersion branches (check mode, already up-to-date,
 * version validation) and error paths.
 *
 * Status messages go through consola (→ process.stderr). Tests capture stderr
 * via a spy on process.stderr.write and assert on the collected output.
 */

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as child_process from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { run } from "@stricli/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Make child_process namespace mutable so vi.spyOn works on ESM exports
vi.mock("node:child_process", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:child_process")>();
  return { ...orig };
});

import { app } from "../../../src/app.js";
import { isEbusyError } from "../../../src/commands/cli/upgrade.js";
import type { SentryContext } from "../../../src/context.js";
import { CLI_VERSION } from "../../../src/lib/constants.js";
import {
  clearInstallInfo,
  setInstallInfo,
} from "../../../src/lib/db/install-info.js";
import {
  getReleaseChannel,
  setReleaseChannel,
} from "../../../src/lib/db/release-channel.js";
import { TEST_TMP_DIR, useTestConfigDir } from "../../helpers.js";

/** Store original fetch for restoration */
let originalFetch: typeof globalThis.fetch;

/** Helper to mock fetch */
function mockFetch(
  fn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>
): void {
  globalThis.fetch = fn as typeof globalThis.fetch;
}

/**
 * Create a mock Stricli context with stderr and stdout capture.
 *
 * `getOutput()` returns **both** consola output (stderr) and structured
 * output (stdout) combined, so assertions work regardless of whether
 * a message is a progress log or a rendered result.
 * `errors` captures Stricli error output written to context.stderr.
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
  errors: string[];
  restore: () => void;
} {
  const stderrChunks: string[] = [];
  const stdoutChunks: string[] = [];
  const errors: string[] = [];
  const env: Record<string, string | undefined> = {
    PATH: "/usr/bin:/bin",
    SHELL: "/bin/bash",
    ...overrides.env,
  };

  // Force rich output so the spinner (which uses isPlainOutput() to decide
  // whether to render) is not suppressed in non-TTY test environments.
  // The formatUpgradeResult output will contain ANSI codes, but test
  // assertions use toContain() which matches through them.
  const origPlain = process.env.SENTRY_PLAIN_OUTPUT;
  process.env.SENTRY_PLAIN_OUTPUT = "0";

  // Capture consola output (routed to process.stderr)
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  // Capture spinner output (routed to process.stdout)
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  const stdoutWriter = {
    write: (s: string) => {
      stdoutChunks.push(s);
      return true;
    },
  };

  const context = {
    process: {
      stdout: stdoutWriter,
      stderr: {
        write: (s: string) => {
          errors.push(s);
          return true;
        },
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
    stdout: stdoutWriter,
    stderr: {
      write: (s: string) => {
        errors.push(s);
        return true;
      },
    },
    stdin: process.stdin,
    setFlags: () => {
      // no-op for tests
    },
  } as unknown as SentryContext;

  return {
    context,
    // Combine stderr (progress) and stdout (rendered result) so assertions
    // work regardless of which stream a message goes to
    getOutput: () => stderrChunks.join("") + stdoutChunks.join(""),
    errors,
    restore: () => {
      process.stderr.write = origStderrWrite;
      process.stdout.write = origStdoutWrite;
      if (origPlain === undefined) {
        delete process.env.SENTRY_PLAIN_OUTPUT;
      } else {
        process.env.SENTRY_PLAIN_OUTPUT = origPlain;
      }
    },
  };
}

/**
 * Mock fetch to simulate GHCR manifest returning a specific nightly version.
 * Handles token exchange and manifest fetch.
 */
function mockGhcrNightlyVersion(version: string): void {
  mockFetch(async (url) => {
    const urlStr = String(url);

    // GHCR anonymous token exchange
    if (urlStr.includes("ghcr.io/token")) {
      return new Response(JSON.stringify({ token: "test-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // GHCR OCI manifest for :nightly tag
    if (urlStr.includes("/manifests/nightly")) {
      return new Response(
        JSON.stringify({
          schemaVersion: 2,
          layers: [],
          annotations: { version },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/vnd.oci.image.manifest.v1+json",
          },
        }
      );
    }

    return new Response("Not Found", { status: 404 });
  });
}

/**
 * Mock fetch to simulate GitHub releases API returning a specific version.
 * Handles the latest release endpoint, version-exists check, and npm registry.
 */
function mockGitHubVersion(version: string): void {
  mockFetch(async (url) => {
    const urlStr = String(url);

    // GitHub latest release endpoint — returns JSON with tag_name
    if (urlStr.includes("releases/latest")) {
      return new Response(JSON.stringify({ tag_name: version }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // GitHub tag check (for versionExists) — this repo uses un-prefixed tags
    if (urlStr.includes("/releases/tags/")) {
      const requested = urlStr.split("/releases/tags/")[1];
      if (requested === version) {
        return new Response(JSON.stringify({ tag_name: version }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    }

    // npm registry fallback
    if (new URL(urlStr).hostname === "registry.npmjs.org") {
      return new Response(JSON.stringify({ version }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  });
}

/**
 * Mock fetch for the nightly version.json endpoint.
 */
/**
 * Mock fetch for GHCR nightly version checks (token exchange + manifest).
 * Used by nightly channel tests — replaces the old GitHub version.json mock.
 */
function mockNightlyVersion(version: string): void {
  mockFetch(async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("ghcr.io/token")) {
      return new Response(JSON.stringify({ token: "test-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlStr.includes("/manifests/nightly")) {
      return new Response(JSON.stringify({ annotations: { version } }), {
        status: 200,
        headers: {
          "content-type": "application/vnd.oci.image.manifest.v1+json",
        },
      });
    }
    return new Response("Not Found", { status: 404 });
  });
}

describe("sentry cli upgrade", () => {
  let testDir: string;
  let restoreStderr: (() => void) | undefined;

  beforeEach(() => {
    testDir = join(
      "/tmp",
      `upgrade-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    restoreStderr?.();
    restoreStderr = undefined;
    globalThis.fetch = originalFetch;
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("--check mode", () => {
    test("shows 'already on the target version' when current equals latest", async () => {
      mockGitHubVersion(CLI_VERSION);

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl"],
        context
      );

      const combined = getOutput();
      expect(combined).toContain("Method: curl");
      expect(combined).toContain(CLI_VERSION);
      expect(combined).toContain("You are already on the target version");
    });

    test("shows upgrade command hint when newer version available", async () => {
      mockGitHubVersion("99.99.99");

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl"],
        context
      );

      const combined = getOutput();
      expect(combined).toContain("99.99.99");
      expect(combined).toContain("Run 'sentry cli upgrade' to update.");
    });

    test("shows version-specific upgrade hint when user-specified version", async () => {
      mockGitHubVersion("99.99.99");

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "88.88.88"],
        context
      );

      const combined = getOutput();
      expect(combined).toContain("88.88.88");
      expect(combined).toContain(
        "Run 'sentry cli upgrade 88.88.88' to update."
      );
    });
  });

  describe("already up to date", () => {
    test("reports already up to date when current equals target", async () => {
      mockGitHubVersion(CLI_VERSION);

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
      });
      restoreStderr = restore;

      await run(app, ["cli", "upgrade", "--method", "curl"], context);

      const combined = getOutput();
      expect(combined).toContain("Already up to date");
      expect(combined).not.toContain("Upgrading to");
    });
  });

  describe("brew method", () => {
    test("errors immediately when specific version requested with brew", async () => {
      // No fetch mock needed — error is thrown before any network call
      const { context, getOutput, errors, restore } = createMockContext({
        homeDir: testDir,
      });
      restoreStderr = restore;

      await run(app, ["cli", "upgrade", "--method", "brew", "1.2.3"], context);

      const allOutput = getOutput() + errors.join("");
      expect(allOutput).toContain(
        "Homebrew does not support installing a specific version"
      );
    });

    test("check mode works for brew method", async () => {
      mockGitHubVersion("99.99.99");

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "brew"],
        context
      );

      const combined = getOutput();
      expect(combined).toContain("Method: brew");
      expect(combined).toContain("99.99.99");
      expect(combined).toContain("Run 'sentry cli upgrade' to update.");
    });
  });

  describe("version validation", () => {
    test("reports error for non-existent version", async () => {
      // Mock: latest is 99.99.99, but 0.0.1 doesn't exist
      mockFetch(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("releases/latest")) {
          return new Response(JSON.stringify({ tag_name: "v99.99.99" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        // Specific version check returns 404
        return new Response("Not Found", { status: 404 });
      });

      const { context, getOutput, errors, restore } = createMockContext({
        homeDir: testDir,
      });
      restoreStderr = restore;

      await run(app, ["cli", "upgrade", "--method", "curl", "0.0.1"], context);

      // Stricli catches errors and writes to stderr / calls exit
      const allOutput = getOutput() + errors.join("");
      expect(allOutput).toContain("Version 0.0.1 not found");
    });

    test("strips v prefix from user-specified version", async () => {
      mockGitHubVersion(CLI_VERSION);

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
      });
      restoreStderr = restore;

      // Pass "v<current>" — should strip prefix and match current
      await run(
        app,
        ["cli", "upgrade", "--method", "curl", `v${CLI_VERSION}`],
        context
      );

      const combined = getOutput();
      // Should match current version (after stripping v prefix) and report up to date
      expect(combined).toContain("Already up to date");
    });
  });

  describe("nightly version check", () => {
    test("--check mode with 'nightly' positional fetches latest from GHCR", async () => {
      const nightlyVersion = "0.0.0-dev.1740000000";
      // 'nightly' as positional switches channel to nightly — fetches from GHCR
      mockGhcrNightlyVersion(nightlyVersion);

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "nightly"],
        context
      );

      const combined = getOutput();
      // Should show nightly channel and latest version from GHCR
      expect(combined).toContain("nightly");
      expect(combined).toContain(nightlyVersion);
    });

    test("--check with 'nightly' positional shows upgrade hint when newer nightly available", async () => {
      const nightlyVersion = "0.0.0-dev.1740000000";
      mockGhcrNightlyVersion(nightlyVersion);

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "nightly"],
        context
      );

      const combined = getOutput();
      // CLI_VERSION is "0.0.0-dev" (not matching nightlyVersion), show upgrade hint
      expect(combined).toContain("sentry cli upgrade");
    });
  });
});

describe("sentry cli upgrade — nightly channel", () => {
  useTestConfigDir("test-upgrade-nightly-");

  let testDir: string;
  let restoreStderr: (() => void) | undefined;

  beforeEach(() => {
    testDir = join(
      "/tmp",
      `upgrade-nightly-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    restoreStderr?.();
    restoreStderr = undefined;
    globalThis.fetch = originalFetch;
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("resolveChannelAndVersion", () => {
    test("'nightly' positional sets channel to nightly", async () => {
      mockNightlyVersion(CLI_VERSION);

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "nightly"],
        context
      );

      const combined = getOutput();
      expect(combined).toContain("Channel: nightly");
    });

    test("'stable' positional sets channel to stable", async () => {
      mockGitHubVersion(CLI_VERSION);
      setReleaseChannel("nightly");

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "stable"],
        context
      );

      const combined = getOutput();
      expect(combined).toContain("Channel: stable");
    });

    test("without positional, uses persisted channel", async () => {
      setReleaseChannel("nightly");
      mockNightlyVersion(CLI_VERSION);

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl"],
        context
      );

      const combined = getOutput();
      expect(combined).toContain("Channel: nightly");
    });
  });

  describe("channel persistence", () => {
    test("persists nightly channel when 'nightly' positional is passed", async () => {
      mockNightlyVersion(CLI_VERSION);

      const { context, restore } = createMockContext({ homeDir: testDir });
      restoreStderr = restore;

      expect(getReleaseChannel()).toBe("stable");

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "nightly"],
        context
      );

      expect(getReleaseChannel()).toBe("nightly");
    });

    test("persists stable channel when 'stable' positional resets from nightly", async () => {
      setReleaseChannel("nightly");
      mockGitHubVersion(CLI_VERSION);

      const { context, restore } = createMockContext({ homeDir: testDir });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "stable"],
        context
      );

      expect(getReleaseChannel()).toBe("stable");
    });
  });

  describe("nightly --check mode", () => {
    test("shows 'already on target' when current matches nightly latest", async () => {
      mockNightlyVersion(CLI_VERSION);

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "nightly"],
        context
      );

      const combined = getOutput();
      expect(combined).toContain("Channel: nightly");
      expect(combined).toContain(CLI_VERSION);
      expect(combined).toContain("You are already on the target version");
    });

    test("shows upgrade hint when newer nightly available", async () => {
      mockNightlyVersion("0.99.0-dev.9999999999");

      const { context, getOutput, restore } = createMockContext({
        homeDir: testDir,
      });
      restoreStderr = restore;

      await run(
        app,
        ["cli", "upgrade", "--check", "--method", "curl", "nightly"],
        context
      );

      const combined = getOutput();
      expect(combined).toContain("Channel: nightly");
      expect(combined).toContain("0.99.0-dev.9999999999");
      expect(combined).toContain("Run 'sentry cli upgrade' to update.");
    });
  });
});

// ---------------------------------------------------------------------------
// Download + setup paths (Option B: child_process.spawn spy)
//
// These tests cover runSetupOnNewBinary and the full executeUpgrade flow by:
//   1. Mocking fetch to return a fake binary payload for downloadBinaryToTemp
//   2. Spying on child_process.spawn so it resolves immediately with exit 0
//
// child_process.spawn is spied via spyOn so the module-level import in the
// production code picks up the mock.
// ---------------------------------------------------------------------------

/**
 * Create a fake ChildProcess-like object that emits "close" with the given
 * exit code on the next microtask. Used to mock child_process.spawn in tests.
 */
function fakeChildProcess(exitCode: number): child_process.ChildProcess {
  const { EventEmitter } = require("node:events");
  const emitter = new EventEmitter();
  // Emit "close" asynchronously so the caller can attach listeners first
  queueMicrotask(() => emitter.emit("close", exitCode));
  return emitter as unknown as child_process.ChildProcess;
}

describe("sentry cli upgrade — curl full upgrade path (child_process.spawn spy)", () => {
  useTestConfigDir("test-upgrade-spawn-");

  let testDir: string;
  let spawnedArgs: Array<{ cmd: string; args: string[] }>;
  let spawnSpy: ReturnType<typeof spyOn>;
  let restoreStderr: (() => void) | undefined;

  /** Redirect curl install paths to temp dir instead of ~/.sentry/bin/ */
  const spawnBinDir = join(TEST_TMP_DIR, "upgrade-spawn-bin");
  const binName = process.platform === "win32" ? "sentry.exe" : "sentry";
  const spawnInstallPath = join(spawnBinDir, binName);

  beforeEach(() => {
    testDir = join(
      TEST_TMP_DIR,
      `upgrade-spawn-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
    mkdirSync(spawnBinDir, { recursive: true });
    // Redirect getCurlInstallPaths() to temp dir
    clearInstallInfo();
    setInstallInfo({
      method: "curl",
      path: spawnInstallPath,
      version: "0.0.0",
    });

    originalFetch = globalThis.fetch;
    spawnedArgs = [];

    // Spy on child_process.spawn — captures args and resolves with exit 0
    spawnSpy = vi
      .spyOn(child_process, "spawn")
      .mockImplementation((cmd: string, args?: readonly string[]) => {
        spawnedArgs.push({ cmd, args: [...(args ?? [])] });
        return fakeChildProcess(0);
      });
  });

  afterEach(async () => {
    restoreStderr?.();
    restoreStderr = undefined;
    globalThis.fetch = originalFetch;
    spawnSpy.mockRestore();
    rmSync(testDir, { recursive: true, force: true });

    // Clean up any temp binary files written to the redirected install path
    for (const suffix of ["", ".download", ".old", ".lock"]) {
      try {
        await unlink(join(spawnBinDir, `${binName}${suffix}`));
      } catch {
        // Ignore
      }
    }
    clearInstallInfo();
  });

  /**
   * Mock fetch to serve both the GitHub latest-release version endpoint and a
   * minimal valid gzipped binary for downloadBinaryToTemp.
   */
  function mockBinaryDownloadWithVersion(version: string): void {
    const fakeContent = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]); // ELF magic
    const gzipped = gzipSync(fakeContent);
    mockFetch(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("releases/latest")) {
        return new Response(JSON.stringify({ tag_name: version }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Binary download (.gz or raw)
      return new Response(gzipped, { status: 200 });
    });
  }

  test("runs setup on downloaded binary after curl upgrade", async () => {
    mockBinaryDownloadWithVersion("99.99.99");

    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
    });
    restoreStderr = restore;

    await run(app, ["cli", "upgrade", "--method", "curl"], context);

    const combined = getOutput();
    // Spinner progress messages written to stdout
    expect(combined).toContain("Checking for updates");
    expect(combined).toContain("Downloading 99.99.99");
    expect(combined).toContain("Upgraded to");
    expect(combined).toContain("99.99.99");

    // Verify child_process.spawn was called with the downloaded binary + setup args
    expect(spawnedArgs.length).toBeGreaterThan(0);
    const setupCall = spawnedArgs.find((entry) => entry.args.includes("setup"));
    expect(setupCall).toBeDefined();
    expect(setupCall?.args).toContain("cli");
    expect(setupCall?.args).toContain("setup");
    expect(setupCall?.args).toContain("--quiet");
    expect(setupCall?.args).toContain("--method");
    expect(setupCall?.args).toContain("curl");
    expect(setupCall?.args).toContain("--install");
  });

  test("reports setup failure when spawn exits non-zero", async () => {
    // Use a unified mock that handles both the version endpoint and binary download
    const fakeContent = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
    const gzipped = gzipSync(fakeContent);
    mockFetch(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("releases/latest")) {
        return new Response(JSON.stringify({ tag_name: "99.99.99" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Binary download (both .gz and raw URLs)
      return new Response(gzipped, { status: 200 });
    });

    spawnSpy.mockImplementation(() => fakeChildProcess(1));

    const { context, errors, restore } = createMockContext({
      homeDir: testDir,
    });
    restoreStderr = restore;

    await run(app, ["cli", "upgrade", "--method", "curl"], context);

    expect(errors.join("")).toContain("Setup failed with exit code 1");
  });

  test("downloads nightly binary from GHCR for nightly channel", async () => {
    const capturedUrls: string[] = [];
    const fakeContent = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
    const gzipped = gzipSync(fakeContent);

    // GHCR flow: token exchange → manifest → blob redirect → blob download
    mockFetch(async (url) => {
      const urlStr = String(url);
      capturedUrls.push(urlStr);
      if (urlStr.includes("ghcr.io/token")) {
        return new Response(JSON.stringify({ token: "test-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (urlStr.includes("/manifests/nightly")) {
        let filename = "sentry-linux-x64.gz";
        if (process.platform === "win32") {
          filename = "sentry-windows-x64.exe.gz";
        } else if (process.platform === "darwin") {
          filename = "sentry-darwin-arm64.gz";
        }
        return new Response(
          JSON.stringify({
            annotations: { version: "0.99.0-dev.1234567890" },
            layers: [
              {
                digest: "sha256:abc123",
                annotations: {
                  "org.opencontainers.image.title": filename,
                },
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/vnd.oci.image.manifest.v1+json",
            },
          }
        );
      }
      if (urlStr.includes("/blobs/sha256:abc123")) {
        // Redirect to blob storage (GHCR blob endpoint returns 307)
        return Response.redirect("https://blob.example.com/file.gz", 307);
      }
      if (urlStr.includes("blob.example.com")) {
        return new Response(gzipped, { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    });

    // "nightly" positional switches channel to nightly
    const { context, restore } = createMockContext({ homeDir: testDir });
    restoreStderr = restore;

    await run(app, ["cli", "upgrade", "--method", "curl", "nightly"], context);

    // Should have fetched from GHCR (token + manifest + blob)
    expect(capturedUrls.some((u) => u.includes("ghcr.io/token"))).toBe(true);
    expect(capturedUrls.some((u) => u.includes("/manifests/nightly"))).toBe(
      true
    );
  });

  test("--force bypasses 'already up to date' and proceeds to download", async () => {
    mockBinaryDownloadWithVersion(CLI_VERSION); // Same version — would normally short-circuit

    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
    });
    restoreStderr = restore;

    await run(app, ["cli", "upgrade", "--method", "curl", "--force"], context);

    const combined = getOutput();
    // With --force, should NOT show "Already up to date"
    expect(combined).not.toContain("Already up to date");
    // Should proceed to download and succeed (spinner messages on stdout)
    expect(combined).toContain(`Downloading ${CLI_VERSION}`);
    expect(combined).toContain("Upgraded to");
    expect(combined).toContain(CLI_VERSION);
  });
});

describe("sentry cli upgrade — migrateToStandaloneForNightly (child_process.spawn spy)", () => {
  useTestConfigDir("test-upgrade-migrate-");

  let testDir: string;
  let migrateSpawnSpy: ReturnType<typeof spyOn>;
  let restoreStderr: (() => void) | undefined;

  /** Redirect curl install paths to temp dir instead of ~/.sentry/bin/ */
  const migrateBinDir = join(TEST_TMP_DIR, "upgrade-migrate-bin");
  const migrateBinName = process.platform === "win32" ? "sentry.exe" : "sentry";
  const migrateInstallPath = join(migrateBinDir, migrateBinName);

  beforeEach(() => {
    testDir = join(
      TEST_TMP_DIR,
      `upgrade-migrate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
    mkdirSync(migrateBinDir, { recursive: true });
    // Redirect getCurlInstallPaths() to temp dir
    clearInstallInfo();
    setInstallInfo({
      method: "curl",
      path: migrateInstallPath,
      version: "0.0.0",
    });

    originalFetch = globalThis.fetch;

    migrateSpawnSpy = vi
      .spyOn(child_process, "spawn")
      .mockImplementation(() => fakeChildProcess(0));
  });

  afterEach(async () => {
    restoreStderr?.();
    restoreStderr = undefined;
    globalThis.fetch = originalFetch;
    migrateSpawnSpy.mockRestore();
    rmSync(testDir, { recursive: true, force: true });

    for (const suffix of ["", ".download", ".old", ".lock"]) {
      try {
        await unlink(join(migrateBinDir, `${migrateBinName}${suffix}`));
      } catch {
        // Ignore
      }
    }
    clearInstallInfo();
  });

  test("migrates npm install to standalone binary for nightly channel", async () => {
    const fakeContent = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
    const gzipped = gzipSync(fakeContent);

    // Nightly is now distributed via GHCR (token → manifest → blob)
    mockFetch(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("ghcr.io/token")) {
        return new Response(JSON.stringify({ token: "test-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (urlStr.includes("/manifests/nightly")) {
        let filename = "sentry-linux-x64.gz";
        if (process.platform === "win32") {
          filename = "sentry-windows-x64.exe.gz";
        } else if (process.platform === "darwin") {
          filename = "sentry-darwin-arm64.gz";
        }
        return new Response(
          JSON.stringify({
            annotations: { version: "0.99.0-dev.1234567890" },
            layers: [
              {
                digest: "sha256:abc456",
                annotations: {
                  "org.opencontainers.image.title": filename,
                },
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/vnd.oci.image.manifest.v1+json",
            },
          }
        );
      }
      if (urlStr.includes("/blobs/sha256:abc456")) {
        return Response.redirect("https://blob.example.com/nightly.gz", 307);
      }
      if (urlStr.includes("blob.example.com")) {
        return new Response(gzipped, { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    });

    // Switch to nightly and use npm method → triggers migration
    setReleaseChannel("nightly");

    const { context, getOutput, restore } = createMockContext({
      homeDir: testDir,
    });
    restoreStderr = restore;

    await run(app, ["cli", "upgrade", "--method", "npm", "nightly"], context);

    const combined = getOutput();
    expect(combined).toContain(
      "Nightly builds are only available as standalone binaries."
    );
    expect(combined).toContain("Migrating to standalone installation...");
    expect(combined).toContain("Upgraded to");
    // Warns about old npm install (rendered via formatUpgradeResult warnings)
    expect(combined).toContain(
      "npm-installed sentry may still appear earlier in PATH"
    );
    expect(combined).toContain("npm uninstall -g sentry");
  });
});

describe("isEbusyError", () => {
  test("returns true for EBUSY errno error", () => {
    const err = new Error("EBUSY: resource busy or locked, uv_spawn");
    (err as NodeJS.ErrnoException).code = "EBUSY";
    expect(isEbusyError(err)).toBe(true);
  });

  test("returns false for ENOENT", () => {
    const err = new Error("ENOENT: no such file or directory");
    (err as NodeJS.ErrnoException).code = "ENOENT";
    expect(isEbusyError(err)).toBe(false);
  });

  test("returns false for EACCES", () => {
    const err = new Error("EACCES: permission denied");
    (err as NodeJS.ErrnoException).code = "EACCES";
    expect(isEbusyError(err)).toBe(false);
  });

  test("returns false for non-Error values", () => {
    expect(isEbusyError("EBUSY")).toBe(false);
    expect(isEbusyError(null)).toBe(false);
    expect(isEbusyError(undefined)).toBe(false);
    expect(isEbusyError(42)).toBe(false);
  });

  test("returns false for Error without code", () => {
    expect(isEbusyError(new Error("some error"))).toBe(false);
  });
});
