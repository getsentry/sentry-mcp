/**
 * Unit tests for the application-boundary argv glue in {@link argv-glue}.
 *
 * Global-flag recognition before a subcommand (`sentry --verbose issue list`)
 * is exercised end-to-end via Stricli's patched route scanner in
 * `argv-glue.integration.test.ts`. These tests focus on the two transforms that
 * still happen before dispatch: `--version` normalization and the `--help
 * --json` rewrite.
 */

import { describe, expect, test } from "vitest";
import {
  isVersionRequest,
  preprocessArgv,
  rewriteHelpJsonRequest,
} from "../../src/lib/argv-glue.js";

describe("isVersionRequest", () => {
  test("true for top-level --version", () => {
    expect(isVersionRequest(["--version"])).toBe(true);
  });

  test("true for --version after a route group (sentry cli --version)", () => {
    expect(isVersionRequest(["cli", "--version"])).toBe(true);
  });

  test("true for --version after a nested subcommand", () => {
    expect(isVersionRequest(["issue", "list", "--version"])).toBe(true);
  });

  test("false when --version is absent", () => {
    expect(isVersionRequest(["cli", "upgrade"])).toBe(false);
    expect(isVersionRequest([])).toBe(false);
  });

  test("does not match the -v short alias (reserved for --verbose)", () => {
    expect(isVersionRequest(["cli", "-v"])).toBe(false);
  });

  test("ignores --version after the -- escape (passed to wrapped command)", () => {
    // `sentry monitor run <slug> -- mytool --version` must forward --version
    // to the wrapped command, not print the Sentry CLI version.
    expect(
      isVersionRequest(["monitor", "run", "job", "--", "mytool", "--version"])
    ).toBe(false);
  });

  test("does not match --version=foo (not a bare version flag)", () => {
    expect(isVersionRequest(["cli", "--version=1.2.3"])).toBe(false);
  });
});

describe("preprocessArgv", () => {
  test("normalizes a route-scoped --version to a plain --version", () => {
    expect(preprocessArgv(["cli", "--version"])).toEqual(["--version"]);
    expect(preprocessArgv(["issue", "list", "--version"])).toEqual([
      "--version",
    ]);
  });

  test("leaves global flags in place for the scanner to handle", () => {
    // Hoisting is gone — argv is passed through unchanged and the patched
    // route scanner recognizes the flag before the subcommand.
    expect(preprocessArgv(["--verbose", "issue", "list"])).toEqual([
      "--verbose",
      "issue",
      "list",
    ]);
    expect(preprocessArgv(["issue", "--org", "acme", "list"])).toEqual([
      "issue",
      "--org",
      "acme",
      "list",
    ]);
  });

  test("rewrites --help --json to the help command", () => {
    expect(preprocessArgv(["--help", "--json"])).toEqual(["help", "--json"]);
    expect(preprocessArgv(["issue", "list", "--help", "--json"])).toEqual([
      "help",
      "--json",
      "issue",
      "list",
    ]);
  });

  test("leaves a bare --help untouched (Stricli renders text help)", () => {
    expect(preprocessArgv(["issue", "--help"])).toEqual(["issue", "--help"]);
  });

  test("leaves a wrapped-command --version (after --) untouched", () => {
    expect(
      preprocessArgv(["monitor", "run", "job", "--", "tool", "--version"])
    ).toEqual(["monitor", "run", "job", "--", "tool", "--version"]);
  });

  test("returns argv unchanged when no transform applies", () => {
    expect(preprocessArgv(["issue", "list", "--limit", "25"])).toEqual([
      "issue",
      "list",
      "--limit",
      "25",
    ]);
    expect(preprocessArgv([])).toEqual([]);
  });
});

describe("rewriteHelpJsonRequest", () => {
  test("rewrites top-level --help --json to the help command", () => {
    expect(rewriteHelpJsonRequest(["--help", "--json"])).toEqual([
      "help",
      "--json",
    ]);
  });

  test("rewrites a group --help --json to help <group>", () => {
    expect(rewriteHelpJsonRequest(["issue", "--help", "--json"])).toEqual([
      "help",
      "--json",
      "issue",
    ]);
  });

  test("recognizes the -h short alias for --help", () => {
    // Stricli treats `-h` as an alias of `--help`, so the JSON rewrite must
    // fire for it too — otherwise `sentry -h --json` falls through to text usage.
    expect(rewriteHelpJsonRequest(["-h", "--json"])).toEqual([
      "help",
      "--json",
    ]);
    expect(rewriteHelpJsonRequest(["issue", "-h", "--json"])).toEqual([
      "help",
      "--json",
      "issue",
    ]);
  });

  test("rewrites a nested command --help --json to help <group> <command>", () => {
    expect(
      rewriteHelpJsonRequest(["issue", "list", "--help", "--json"])
    ).toEqual(["help", "--json", "issue", "list"]);
  });

  test("is order-insensitive between --help and --json", () => {
    expect(rewriteHelpJsonRequest(["--json", "issue", "--help"])).toEqual([
      "help",
      "--json",
      "issue",
    ]);
  });

  test("carries a --fields value through to the help command", () => {
    expect(
      rewriteHelpJsonRequest([
        "issue",
        "list",
        "--help",
        "--json",
        "--fields",
        "path,brief",
      ])
    ).toEqual(["help", "--json", "issue", "list", "--fields", "path,brief"]);
  });

  test("carries a --fields=value form through to the help command", () => {
    expect(
      rewriteHelpJsonRequest(["issue", "--help", "--json", "--fields=path"])
    ).toEqual(["help", "--json", "issue", "--fields", "path"]);
  });

  test("drops unrelated flags from the rewritten path", () => {
    expect(
      rewriteHelpJsonRequest(["--verbose", "issue", "--help", "--json"])
    ).toEqual(["help", "--json", "issue"]);
  });

  test("drops a value flag's spaced value so it never becomes a path segment", () => {
    // `--org acme` / `--limit 5` must not leak `acme` / `5` into the command
    // path, which would resolve the wrong command or a not-found error.
    expect(
      rewriteHelpJsonRequest([
        "issue",
        "list",
        "--org",
        "acme",
        "--help",
        "--json",
      ])
    ).toEqual(["help", "--json", "issue", "list"]);
    expect(
      rewriteHelpJsonRequest([
        "issue",
        "list",
        "--limit",
        "5",
        "--help",
        "--json",
      ])
    ).toEqual(["help", "--json", "issue", "list"]);
  });

  test("keeps a path segment following a boolean flag", () => {
    // `--verbose` is a known boolean flag, so the token after it (`list`) is a
    // real command-path segment, not a flag value.
    expect(
      rewriteHelpJsonRequest(["issue", "--verbose", "list", "--help", "--json"])
    ).toEqual(["help", "--json", "issue", "list"]);
  });

  test("keeps a path segment following an =-form value flag", () => {
    // `--org=acme` carries its value inline, so the next token (`issue`/`list`)
    // is a real command-path segment. A naive length check would treat the
    // whole `org=acme` string as an unknown value flag and swallow `issue`.
    expect(
      rewriteHelpJsonRequest([
        "--org=acme",
        "issue",
        "list",
        "--help",
        "--json",
      ])
    ).toEqual(["help", "--json", "issue", "list"]);
    expect(
      rewriteHelpJsonRequest(["issue", "--limit=5", "list", "--help", "--json"])
    ).toEqual(["help", "--json", "issue", "list"]);
  });

  test("does not let --fields swallow a following flag", () => {
    // `--fields --json`: --fields has no value, and --json must still register
    // so the rewrite fires.
    expect(
      rewriteHelpJsonRequest(["issue", "list", "--help", "--fields", "--json"])
    ).toEqual(["help", "--json", "issue", "list"]);
  });

  test("returns null for bare --help without --json", () => {
    expect(rewriteHelpJsonRequest(["issue", "--help"])).toBeNull();
  });

  test("returns null for --json without --help", () => {
    expect(rewriteHelpJsonRequest(["issue", "list", "--json"])).toBeNull();
  });

  test("returns null when neither flag is present", () => {
    expect(rewriteHelpJsonRequest(["issue", "list"])).toBeNull();
  });

  test("ignores --help --json after the -- escape separator", () => {
    // `sentry monitor run <slug> -- tool --help --json` must forward the flags
    // to the wrapped command, not print the CLI's JSON help.
    expect(
      rewriteHelpJsonRequest([
        "monitor",
        "run",
        "job",
        "--",
        "tool",
        "--help",
        "--json",
      ])
    ).toBeNull();
  });

  test("rewrites --help --json seen before a -- escape separator", () => {
    // Flags before `--` still count: the scan stops at `--` but keeps what it
    // already found, so `--help --json -- passthru` yields JSON help.
    expect(
      rewriteHelpJsonRequest(["issue", "list", "--help", "--json", "--", "x"])
    ).toEqual(["help", "--json", "issue", "list"]);
  });
});
