/**
 * Exercises the shell installer with a fake downloaded executable. Real PTYs
 * verify terminal reconnection for setup and the existing init handoff.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const installScript = join(import.meta.dirname, "..", "..", "install");
const downloadedExecutable = `#!/usr/bin/env bash
set -euo pipefail
record_tty() {
  for fd in 0 1 2; do
    if [[ -t "$fd" ]]; then
      printf '%s:true\\n' "$fd" >&3
    else
      printf '%s:false\\n' "$fd" >&3
    fi
  done
  if { : </dev/tty; } 2>/dev/null; then
    printf 'controlling:true\\n' >&3
  else
    printf 'controlling:false\\n' >&3
  fi
}
if [[ "$1" == "cli" && "$2" == "setup" ]]; then
  printf '%s\\n' "$@" > "$SENTRY_TEST_DIR/setup-args"
  printf '%s\\n' "$0" > "$SENTRY_TEST_DIR/setup-binary"
  record_tty 3> "$SENTRY_TEST_DIR/setup-tty"
  mkdir -p "$SENTRY_INSTALL_DIR"
  cp "$0" "$SENTRY_INSTALL_DIR/sentry"
  rm "$0"
  exit "\${SENTRY_TEST_SETUP_EXIT:-0}"
fi
printf '%s\\n' "$@" >> "$SENTRY_TEST_DIR/post-args"
printf '%s\\n' "$0" >> "$SENTRY_TEST_DIR/post-binary"
record_tty 3> "$SENTRY_TEST_DIR/post-tty"
exit "\${SENTRY_TEST_POST_EXIT:-0}"
`;

describe("install script", () => {
  let testDir: string;
  let binDir: string;
  let installDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "sentry-install-test-"));
    binDir = join(testDir, "bin");
    installDir = join(testDir, "installed bin");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(testDir, "home"));
    env = {
      PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: join(testDir, "home"),
      SENTRY_INSTALL_DIR: installDir,
      SENTRY_CLI_NO_TELEMETRY: "1",
      SENTRY_TEST_DIR: testDir,
      SENTRY_TEST_INSTALL_SCRIPT: installScript,
      TMPDIR: testDir,
    };

    writeFileSync(
      join(binDir, "curl"),
      `#!/usr/bin/env bash
cat <<'SCRIPT'
${downloadedExecutable}SCRIPT
`
    );
    chmodSync(join(binDir, "curl"), 0o755);
    writeFileSync(join(binDir, "gunzip"), "#!/usr/bin/env bash\ncat\n");
    chmodSync(join(binDir, "gunzip"), 0o755);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function recorded(name: string): string[] {
    const path = join(testDir, name);
    return existsSync(path)
      ? readFileSync(path, "utf8").trim().split("\n")
      : [];
  }

  function configureNightlyDownload(redirect: boolean): void {
    const platform = process.platform === "darwin" ? "darwin" : "linux";
    const architecture = process.arch === "arm64" ? "arm64" : "x64";
    const assetName = `sentry-${platform}-${architecture}.gz`;
    const gzipPath = join(testDir, assetName);
    const manifest = JSON.stringify({
      version: "nightly-test",
      layers: [
        {
          mediaType: "application/vnd.oci.image.layer.v1.tar",
          digest: "sha256:test",
          annotations: { "org.opencontainers.image.title": assetName },
        },
      ],
    });

    writeFileSync(gzipPath, gzipSync(downloadedExecutable));
    env.SENTRY_TEST_GZIP = gzipPath;
    env.SENTRY_TEST_NIGHTLY_REDIRECT = redirect ? "1" : "0";
    writeFileSync(
      join(binDir, "curl"),
      `#!/usr/bin/env bash
set -euo pipefail
url="\${!#}"
case "$url" in
  *"/token?"*)
    printf '{"token":"test-token"}'
    ;;
  *"/manifests/nightly")
    cat <<'JSON'
${manifest}
JSON
    ;;
  "https://objects.example/nightly.gz")
    for arg in "$@"; do
      if [[ "$arg" == Authorization:* ]]; then
        exit 90
      fi
    done
    cat "$SENTRY_TEST_GZIP"
    ;;
  *"/blobs/"*)
    headers=""
    output=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -D) headers="$2"; shift 2 ;;
        -o) output="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    if [[ "$SENTRY_TEST_NIGHTLY_REDIRECT" == "1" ]]; then
      printf 'HTTP/1.1 307 Temporary Redirect\\r\\nLocation: https://objects.example/nightly.gz\\r\\n\\r\\n' > "$headers"
      : > "$output"
      printf '307'
    else
      printf 'HTTP/1.1 200 OK\\r\\n\\r\\n' > "$headers"
      cp "$SENTRY_TEST_GZIP" "$output"
      printf '200'
    fi
    ;;
  *)
    exit 91
    ;;
esac
`
    );
    chmodSync(join(binDir, "curl"), 0o755);
    writeFileSync(
      join(binDir, "gunzip"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ $# -gt 0 && "$1" != "-c" ]]; then
  exit 64
fi
exec /usr/bin/gunzip "$@"
`
    );
    chmodSync(join(binDir, "gunzip"), 0o755);
  }

  /** Run curl-style piped installation in a real controlling terminal. */
  function runInTerminal(
    options: { redirect?: string; detached?: boolean } = {}
  ) {
    const launcher = join(testDir, "piped-install.cjs");
    const command =
      'cat "$SENTRY_TEST_INSTALL_SCRIPT" | bash -s -- --version 0.31.0' +
      (options.redirect ?? "");
    writeFileSync(
      launcher,
      `const { spawnSync } = require("node:child_process");
const result = spawnSync("bash", ["-c", ${JSON.stringify(command)}], {
  stdio: "inherit", detached: ${options.detached ?? false}
});
process.exitCode = result.status ?? 1;
`
    );
    // script(1) has different argument syntax on BSD and util-linux. A
    // detached shell retains its PTY output but cannot open /dev/tty.
    const args =
      process.platform === "darwin"
        ? ["-q", "/dev/null", process.execPath, launcher]
        : [
            "-q",
            "-e",
            "-c",
            '"$SENTRY_TEST_NODE" "$SENTRY_TEST_LAUNCHER"',
            "/dev/null",
          ];
    return spawnSync("script", args, {
      env: {
        ...env,
        SENTRY_TEST_NODE: process.execPath,
        SENTRY_TEST_LAUNCHER: launcher,
      },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 10_000,
    });
  }

  test("passes setup flags through and skips login without a terminal", () => {
    const result = spawnSync(
      "bash",
      [
        installScript,
        "--version",
        "0.31.0",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
      ],
      { env, encoding: "utf8", timeout: 10_000 }
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(recorded("setup-args")).toEqual([
      "cli",
      "setup",
      "--install",
      "--method",
      "curl",
      "--channel",
      "stable",
      "--no-modify-path",
      "--no-completions",
      "--no-agent-skills",
    ]);
    expect(recorded("setup-tty").slice(0, 3)).toEqual([
      "0:false",
      "1:false",
      "2:false",
    ]);
    expect(recorded("post-args")).toEqual([]);
    expect(existsSync(join(installDir, "sentry"))).toBe(true);
  });

  test.each([
    { response: "direct HTTP 200 response", redirect: false },
    { response: "HTTP redirect", redirect: true },
  ])("installs nightly from a $response", ({ redirect }) => {
    configureNightlyDownload(redirect);
    const result = spawnSync(
      "bash",
      [installScript, "--version", "nightly", "--no-modify-path"],
      { env, encoding: "utf8", timeout: 10_000 }
    );

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(recorded("setup-args")).toEqual([
      "cli",
      "setup",
      "--install",
      "--method",
      "curl",
      "--channel",
      "nightly",
      "--no-modify-path",
    ]);
    expect(existsSync(join(installDir, "sentry"))).toBe(true);
  });

  test("connects setup to the controlling terminal without launching another process", () => {
    const result = runInTerminal();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(recorded("setup-tty")).toEqual([
      "0:true",
      "1:true",
      "2:true",
      "controlling:true",
    ]);
    expect(recorded("post-args")).toEqual([]);
    expect(existsSync(join(installDir, "sentry"))).toBe(true);
  });

  test.each([
    {
      name: "stdout is redirected",
      redirect: " >/dev/null",
      expected: ["0:false", "1:false", "2:true", "controlling:true"],
    },
    {
      name: "stderr is redirected",
      redirect: " 2>/dev/null",
      expected: ["0:false", "1:true", "2:false", "controlling:true"],
    },
    {
      name: "terminal output has no controlling terminal",
      detached: true,
      expected: ["0:false", "1:true", "2:true", "controlling:false"],
    },
  ])("skips login when $name", ({ redirect, detached, expected }) => {
    const result = runInTerminal({ redirect, detached });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(recorded("setup-tty")).toEqual(expected);
    expect(recorded("post-args")).toEqual([]);
  });

  test("hands off to init instead of login when SENTRY_INIT is set", () => {
    env.SENTRY_INIT = "1";
    env.SENTRY_TEST_POST_EXIT = "7";
    const result = runInTerminal();
    expect(result.status, result.stdout + result.stderr).toBe(7);
    expect(recorded("setup-tty")[0]).toBe("0:false");
    expect(recorded("post-args")).toEqual(["init"]);
    expect(recorded("post-binary")).toEqual([join(installDir, "sentry")]);
    expect(recorded("post-tty")).toEqual([
      "0:true",
      "1:true",
      "2:true",
      "controlling:true",
    ]);
  });

  test.each([
    1, 130,
  ])("preserves setup failure or interruption exit %i", (exitCode) => {
    env.SENTRY_TEST_SETUP_EXIT = String(exitCode);
    const result = runInTerminal();
    expect(result.status, result.stdout + result.stderr).toBe(exitCode);
    expect(recorded("post-args")).toEqual([]);
    expect(existsSync(join(installDir, "sentry"))).toBe(true);
  });

  test.each([1, 130])("preserves non-interactive setup exit %i", (exitCode) => {
    env.SENTRY_TEST_SETUP_EXIT = String(exitCode);
    const result = spawnSync("bash", [installScript, "--version", "0.31.0"], {
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.status, result.stdout + result.stderr).toBe(exitCode);
    expect(recorded("post-args")).toEqual([]);
    expect(existsSync(join(installDir, "sentry"))).toBe(true);
  });
});
