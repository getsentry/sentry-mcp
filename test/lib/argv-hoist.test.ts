/**
 * Unit tests for {@link hoistGlobalFlags}.
 *
 * Core invariants (token conservation, order preservation, idempotency) are
 * tested via property-based tests in argv-hoist.property.test.ts. These tests
 * focus on specific scenarios and edge cases.
 */

import { describe, expect, test } from "vitest";
import {
  hoistGlobalFlags,
  isVersionRequest,
  preprocessArgv,
  rewriteDashedFlagValues,
} from "../../src/lib/argv-hoist.js";

describe("hoistGlobalFlags", () => {
  // -------------------------------------------------------------------------
  // Passthrough (no hoistable flags)
  // -------------------------------------------------------------------------

  test("returns empty array for empty input", () => {
    expect(hoistGlobalFlags([])).toEqual([]);
  });

  test("returns argv unchanged when no global flags present", () => {
    expect(hoistGlobalFlags(["issue", "list", "--limit", "25"])).toEqual([
      "issue",
      "list",
      "--limit",
      "25",
    ]);
  });

  test("does not hoist unknown flags", () => {
    expect(hoistGlobalFlags(["--limit", "25", "issue", "list"])).toEqual([
      "--limit",
      "25",
      "issue",
      "list",
    ]);
  });

  // -------------------------------------------------------------------------
  // Boolean flag hoisting: --verbose
  // -------------------------------------------------------------------------

  test("hoists --verbose from before subcommand", () => {
    expect(hoistGlobalFlags(["--verbose", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--verbose",
    ]);
  });

  test("hoists --verbose from middle position", () => {
    expect(hoistGlobalFlags(["cli", "--verbose", "upgrade"])).toEqual([
      "cli",
      "upgrade",
      "--verbose",
    ]);
  });

  test("flag already at end stays at end", () => {
    expect(hoistGlobalFlags(["issue", "list", "--verbose"])).toEqual([
      "issue",
      "list",
      "--verbose",
    ]);
  });

  // -------------------------------------------------------------------------
  // Short alias: -v
  // -------------------------------------------------------------------------

  test("hoists -v from before subcommand", () => {
    expect(hoistGlobalFlags(["-v", "issue", "list"])).toEqual([
      "issue",
      "list",
      "-v",
    ]);
  });

  test("hoists -v from middle position", () => {
    expect(hoistGlobalFlags(["cli", "-v", "upgrade"])).toEqual([
      "cli",
      "upgrade",
      "-v",
    ]);
  });

  test("does not hoist unknown short flags", () => {
    expect(hoistGlobalFlags(["-x", "issue", "list"])).toEqual([
      "-x",
      "issue",
      "list",
    ]);
  });

  // -------------------------------------------------------------------------
  // Negation: --no-verbose, --no-json
  // -------------------------------------------------------------------------

  test("hoists --no-verbose", () => {
    expect(hoistGlobalFlags(["--no-verbose", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--no-verbose",
    ]);
  });

  test("hoists --no-json", () => {
    expect(hoistGlobalFlags(["--no-json", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--no-json",
    ]);
  });

  test("does not hoist --no-log-level (not negatable)", () => {
    expect(hoistGlobalFlags(["--no-log-level", "issue", "list"])).toEqual([
      "--no-log-level",
      "issue",
      "list",
    ]);
  });

  // -------------------------------------------------------------------------
  // Boolean flag: --json
  // -------------------------------------------------------------------------

  test("hoists --json from before subcommand", () => {
    expect(hoistGlobalFlags(["--json", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--json",
    ]);
  });

  // -------------------------------------------------------------------------
  // Value flag: --log-level (separate value)
  // -------------------------------------------------------------------------

  test("hoists --log-level with separate value", () => {
    expect(hoistGlobalFlags(["--log-level", "debug", "issue", "list"])).toEqual(
      ["issue", "list", "--log-level", "debug"]
    );
  });

  test("hoists --log-level=debug as single token", () => {
    expect(hoistGlobalFlags(["--log-level=debug", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--log-level=debug",
    ]);
  });

  test("hoists --log-level at end with no value", () => {
    expect(hoistGlobalFlags(["issue", "list", "--log-level"])).toEqual([
      "issue",
      "list",
      "--log-level",
    ]);
  });

  // -------------------------------------------------------------------------
  // Value flag: --fields
  // -------------------------------------------------------------------------

  test("hoists --fields with separate value", () => {
    expect(hoistGlobalFlags(["--fields", "id,title", "issue", "list"])).toEqual(
      ["issue", "list", "--fields", "id,title"]
    );
  });

  test("hoists --fields=id,title as single token", () => {
    expect(hoistGlobalFlags(["--fields=id,title", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--fields=id,title",
    ]);
  });

  // -------------------------------------------------------------------------
  // Value flag: --org (compat)
  // -------------------------------------------------------------------------

  test("hoists --org with separate value", () => {
    expect(hoistGlobalFlags(["--org", "sentry", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--org",
      "sentry",
    ]);
  });

  test("hoists --org=sentry as single token", () => {
    expect(hoistGlobalFlags(["--org=sentry", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--org=sentry",
    ]);
  });

  // -------------------------------------------------------------------------
  // Value flag: --project (compat)
  // -------------------------------------------------------------------------

  test("hoists --project with separate value", () => {
    expect(hoistGlobalFlags(["--project", "cli", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--project",
      "cli",
    ]);
  });

  test("hoists --project=cli as single token", () => {
    expect(hoistGlobalFlags(["--project=cli", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--project=cli",
    ]);
  });

  // -------------------------------------------------------------------------
  // Combined: --org + --project (compat)
  // -------------------------------------------------------------------------

  test("hoists --org and --project together", () => {
    expect(
      hoistGlobalFlags(["--org", "sentry", "--project", "cli", "issue", "list"])
    ).toEqual(["issue", "list", "--org", "sentry", "--project", "cli"]);
  });

  // -------------------------------------------------------------------------
  // Multiple flags
  // -------------------------------------------------------------------------

  test("hoists multiple global flags preserving relative order", () => {
    expect(hoistGlobalFlags(["--verbose", "--json", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--verbose",
      "--json",
    ]);
  });

  test("hoists flags from mixed positions", () => {
    expect(
      hoistGlobalFlags([
        "--verbose",
        "issue",
        "--json",
        "list",
        "--fields",
        "id",
      ])
    ).toEqual(["issue", "list", "--verbose", "--json", "--fields", "id"]);
  });

  // -------------------------------------------------------------------------
  // Repeated flags
  // -------------------------------------------------------------------------

  test("hoists duplicate --verbose flags", () => {
    expect(
      hoistGlobalFlags(["--verbose", "issue", "--verbose", "list"])
    ).toEqual(["issue", "list", "--verbose", "--verbose"]);
  });

  // -------------------------------------------------------------------------
  // -- separator
  // -------------------------------------------------------------------------

  test("does not hoist flags after -- separator", () => {
    expect(hoistGlobalFlags(["issue", "--", "--verbose", "list"])).toEqual([
      "issue",
      "--",
      "--verbose",
      "list",
    ]);
  });

  test("hoists flags before -- and places them before the separator", () => {
    expect(hoistGlobalFlags(["--verbose", "issue", "--", "--json"])).toEqual([
      "issue",
      "--verbose",
      "--",
      "--json",
    ]);
  });

  test("hoisted flags appear before -- not after it", () => {
    expect(
      hoistGlobalFlags(["--verbose", "issue", "--", "positional-arg"])
    ).toEqual(["issue", "--verbose", "--", "positional-arg"]);
  });

  // -------------------------------------------------------------------------
  // Real-world scenarios
  // -------------------------------------------------------------------------

  test("hoists from root level for deeply nested commands", () => {
    expect(hoistGlobalFlags(["--verbose", "--json", "cli", "upgrade"])).toEqual(
      ["cli", "upgrade", "--verbose", "--json"]
    );
  });

  test("hoists --verbose for api command", () => {
    expect(hoistGlobalFlags(["--verbose", "api", "/endpoint"])).toEqual([
      "api",
      "/endpoint",
      "--verbose",
    ]);
  });

  test("hoists -v with log-level from root", () => {
    expect(
      hoistGlobalFlags(["-v", "--log-level", "debug", "cli", "upgrade"])
    ).toEqual(["cli", "upgrade", "-v", "--log-level", "debug"]);
  });

  test("preserves non-global flags in original position", () => {
    expect(
      hoistGlobalFlags([
        "--verbose",
        "issue",
        "list",
        "my-org/",
        "--limit",
        "25",
        "--sort",
        "date",
      ])
    ).toEqual([
      "issue",
      "list",
      "my-org/",
      "--limit",
      "25",
      "--sort",
      "date",
      "--verbose",
    ]);
  });
});

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

describe("rewriteDashedFlagValues", () => {
  test("rewrites --from followed by a dashed token to equals form", () => {
    expect(
      rewriteDashedFlagValues([
        "release",
        "set-commits",
        "1.0.0",
        "--from",
        "--format=x",
      ])
    ).toEqual(["release", "set-commits", "1.0.0", "--from=--format=x"]);
  });

  test("does not rewrite --from followed by a single-dash token", () => {
    expect(
      rewriteDashedFlagValues([
        "release",
        "set-commits",
        "1.0.0",
        "--from",
        "-v1.0",
      ])
    ).toEqual(["release", "set-commits", "1.0.0", "--from", "-v1.0"]);
  });

  test("does not rewrite --from followed by a global flag", () => {
    expect(
      rewriteDashedFlagValues([
        "release",
        "set-commits",
        "1.0.0",
        "--from",
        "--json",
      ])
    ).toEqual(["release", "set-commits", "1.0.0", "--from", "--json"]);
  });

  test("leaves --from= already in equals form unchanged", () => {
    expect(
      rewriteDashedFlagValues([
        "release",
        "set-commits",
        "1.0.0",
        "--from=-format=x",
      ])
    ).toEqual(["release", "set-commits", "1.0.0", "--from=-format=x"]);
  });

  test("does not rewrite tokens after --", () => {
    expect(
      rewriteDashedFlagValues([
        "release",
        "set-commits",
        "1.0.0",
        "--",
        "--from",
        "--format=x",
      ])
    ).toEqual([
      "release",
      "set-commits",
      "1.0.0",
      "--",
      "--from",
      "--format=x",
    ]);
  });
});

describe("preprocessArgv", () => {
  test("normalizes a route-scoped --version to a plain --version", () => {
    expect(preprocessArgv(["cli", "--version"])).toEqual(["--version"]);
    expect(preprocessArgv(["issue", "list", "--version"])).toEqual([
      "--version",
    ]);
  });

  test("hoists global flags when no --version is present", () => {
    expect(preprocessArgv(["--verbose", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--verbose",
    ]);
  });

  test("leaves a wrapped-command --version (after --) to hoisting, not version", () => {
    expect(
      preprocessArgv(["monitor", "run", "job", "--", "tool", "--version"])
    ).toEqual(["monitor", "run", "job", "--", "tool", "--version"]);
  });

  test("rewrites dashed --from values before hoisting global flags", () => {
    expect(
      preprocessArgv([
        "--verbose",
        "release",
        "set-commits",
        "1.0.0",
        "--from",
        "--format=x",
      ])
    ).toEqual([
      "release",
      "set-commits",
      "1.0.0",
      "--from=--format=x",
      "--verbose",
    ]);
  });

  test("preserves --json when it follows --from without a ref", () => {
    expect(
      preprocessArgv(["release", "set-commits", "1.0.0", "--from", "--json"])
    ).toEqual(["release", "set-commits", "1.0.0", "--from", "--json"]);
  });

  test("does not rewrite --from followed by another set-commits flag", () => {
    expect(
      rewriteDashedFlagValues([
        "release",
        "set-commits",
        "1.0.0",
        "--from",
        "--auto",
      ])
    ).toEqual(["release", "set-commits", "1.0.0", "--from", "--auto"]);
  });
});
