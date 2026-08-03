/**
 * Application-boundary argv glue applied before Stricli dispatch.
 *
 * Global flags placed before the subcommand (`sentry --verbose issue list`) are
 * now recognized directly by Stricli's route scanner via our `@stricli/core`
 * patch (a top-level-flags allow-list in `buildRouteScanner`), so no argv
 * hoisting is needed. Two behaviors still have to be handled at the application
 * boundary, before `run()`, because Stricli only implements them at fixed
 * positions:
 *
 * 1. **`--version` at any depth.** Stricli prints the version only when
 *    `--version`/`-v` is the very first token (handled in its `runApplication`
 *    before the scanner runs). `sentry cli --version` or
 *    `sentry <group> <sub> --version` would otherwise route `--version` as an
 *    unknown subcommand. {@link isVersionRequest} detects a bare `--version`
 *    anywhere before a `--` escape so we can normalize it to `["--version"]`.
 *
 * 2. **`--help --json` structured output.** Stricli intercepts `--help` and
 *    prints its own text usage, ignoring `--json`. The dedicated `help` command
 *    already emits structured JSON via `introspectAllCommands` /
 *    `introspectCommand`, so {@link rewriteHelpJsonRequest} reroutes a flag-based
 *    `--help --json` request to that command, giving both help UX paths
 *    identical JSON.
 *
 * Flag metadata is derived from the shared {@link GLOBAL_FLAGS} definition so
 * the glue stays in sync with the flags injected by `buildCommand`.
 */

import { GLOBAL_FLAGS } from "./global-flags.js";

/** Long flag name → whether the flag consumes the next token as its value. */
const FLAG_TAKES_VALUE = new Map(
  GLOBAL_FLAGS.map((f) => [f.name, f.kind === "value"])
);

/** Short alias → whether the flag consumes the next token as its value. */
const SHORT_TAKES_VALUE = new Map(
  GLOBAL_FLAGS.filter(
    (f): f is (typeof GLOBAL_FLAGS)[number] & { short: string } =>
      f.short !== null
  ).map((f) => [f.short, f.kind === "value"])
);

/** Long names that support `--no-<name>` negation (boolean flags). */
const NEGATABLE_NAMES = new Set(
  GLOBAL_FLAGS.filter((f) => f.kind === "boolean").map((f) => f.name)
);

/**
 * Detect a top-level `--version` request anywhere in the command path.
 *
 * Stricli only handles `--version` at the application proxy, so it works for
 * `sentry --version` but not for `sentry cli --version` (the route map treats
 * `--version` as an unknown subcommand) or `sentry <group> <sub> --version`.
 * Callers use this to normalize such invocations to a plain `--version` so the
 * app-level handler prints the version consistently.
 *
 * Only the long `--version` form is recognized: `-v` is the reserved short
 * alias for `--verbose` (see {@link GLOBAL_FLAGS}). Tokens after a `--` escape
 * separator are ignored so `sentry monitor run <slug> -- tool --version`
 * forwards `--version` to the wrapped command instead of printing the CLI
 * version. The `--version=value` form is not matched (no command defines a
 * `--version` value flag).
 *
 * This is a naive token scan, so a bare `--version` token always wins — even
 * when it would otherwise be the value of a preceding value flag (e.g. the
 * contrived `sentry issue list -q --version`). Use the `=` form
 * (`-q=--version`) to pass the literal string instead. No command defines a
 * `--version` flag, so there is no real collision.
 *
 * @param argv - Raw CLI arguments (e.g., `process.argv.slice(2)`)
 * @returns true if a bare `--version` token appears before any `--` separator
 */
export function isVersionRequest(argv: readonly string[]): boolean {
  for (const token of argv) {
    if (token === "--") {
      return false;
    }
    if (token === "--version") {
      return true;
    }
  }
  return false;
}

/**
 * Accumulator for {@link rewriteHelpJsonRequest} while scanning argv.
 */
type HelpJsonScan = {
  hasHelp: boolean;
  hasJson: boolean;
  commandPath: string[];
  fields: string | undefined;
};

/**
 * True when `token` is a boolean-style global flag that does NOT consume a
 * following value token — a known boolean global flag (`--verbose`, `--json`,
 * its `-v` alias, or a `--no-<flag>` negation). Everything else that starts with
 * `-` is assumed to be value-taking, so its next token is a flag value rather
 * than a command-path segment.
 *
 * Used by {@link scanHelpJsonToken} to avoid swallowing a real path segment
 * after a boolean flag (`issue --verbose list`) while still discarding the
 * values of value flags (`--org acme`, `--limit 5`).
 */
function isBooleanFlagToken(token: string): boolean {
  if (token.length === 2 && token[0] === "-" && token[1] !== "-") {
    const takesValue = SHORT_TAKES_VALUE.get(token[1] ?? "");
    return takesValue === undefined ? false : !takesValue;
  }
  if (!token.startsWith("--")) {
    return false;
  }
  const name = token.slice(2);
  if (name.startsWith("no-") && NEGATABLE_NAMES.has(name.slice(3))) {
    return true;
  }
  const takesValue = FLAG_TAKES_VALUE.get(name);
  return takesValue === undefined ? false : !takesValue;
}

/**
 * Fold a single argv token into the {@link HelpJsonScan} accumulator.
 *
 * Recognizes `--help` (and its `-h` alias), `--json`, and `--fields` (both
 * spaced and `=` forms), collects non-flag tokens as the command path, and
 * drops all other flags — including the spaced value of any value-taking flag
 * (`--org acme`, `--limit 5`) so those values never leak into the resolved
 * command path.
 *
 * @returns The number of tokens consumed (1, or 2 when a value flag's spaced
 *   value is dropped alongside it).
 */
function scanHelpJsonToken(
  argv: readonly string[],
  index: number,
  scan: HelpJsonScan
): number {
  const token = argv[index] ?? "";
  // `-h` is Stricli's built-in short alias for `--help`, so it must trigger the
  // JSON rewrite too — otherwise `sentry -h --json` falls through to text usage.
  if (token === "--help" || token === "-h") {
    scan.hasHelp = true;
    return 1;
  }
  if (token === "--json") {
    scan.hasJson = true;
    return 1;
  }
  if (token.startsWith("--fields=")) {
    scan.fields = token.slice("--fields=".length);
    return 1;
  }
  const next = argv[index + 1];
  // A spaced value is only present when the next token isn't itself a flag —
  // `--fields --json` leaves --fields valueless rather than eating --json.
  const hasSpacedValue = next !== undefined && !next.startsWith("-");
  if (token === "--fields") {
    if (hasSpacedValue) {
      scan.fields = next;
      return 2;
    }
    return 1;
  }
  if (!token.startsWith("-")) {
    scan.commandPath.push(token);
    return 1;
  }
  // Any other flag is irrelevant to the help command's structured output and
  // is dropped. A value flag (`--org acme`, `--limit 5`) also drops its spaced
  // value so it isn't mistaken for a command-path segment; a boolean flag
  // (`--verbose`) leaves the following token for the path. An `=`-form flag
  // (`--org=acme`) already carries its value inline, so it never consumes the
  // following token — dropping it would swallow a real command-path segment.
  if (hasSpacedValue && !token.includes("=") && !isBooleanFlagToken(token)) {
    return 2;
  }
  return 1;
}

/**
 * Rewrite a flag-based `--help --json` request into a `help` command invocation.
 *
 * Stricli handles `--help` internally by printing its own text usage and
 * ignores `--json` entirely, so `sentry --help --json` and
 * `sentry <command> --help --json` never produce structured output. Agents and
 * tooling reach for `--help` first, so we rewrite these forms to the dedicated
 * `help` command — which already emits JSON via {@link introspectAllCommands}
 * and {@link introspectCommand} — giving both help UX paths identical JSON.
 *
 * The rewrite only fires when **both** `--help` and `--json` appear before any
 * `--` escape separator. A bare `--help` (no `--json`) is left untouched so
 * Stricli's existing human usage output is preserved unchanged.
 *
 * The command path is the sequence of non-flag tokens (e.g. `issue list`), and
 * a `--fields <value>` (or `--fields=<value>`) flag is carried through so field
 * selection keeps working. The result is `["help", "--json", ...path]` with
 * `--fields` appended when present.
 *
 * @param argv - Raw CLI arguments (e.g., `process.argv.slice(2)`)
 * @returns The rewritten `help`-command argv, or `null` if the request is not a
 *   `--help --json` combination and should be processed normally.
 */
export function rewriteHelpJsonRequest(
  argv: readonly string[]
): string[] | null {
  const scan: HelpJsonScan = {
    hasHelp: false,
    hasJson: false,
    commandPath: [],
    fields: undefined,
  };

  for (let i = 0; i < argv.length; ) {
    // Stop at the escape separator: tokens after `--` are positional/pass-through
    // and must not be interpreted (a `--help`/`--json` there belongs to the
    // wrapped command). Flags seen *before* `--` still count, so
    // `sentry <cmd> --help --json -- passthru` rewrites while
    // `sentry <cmd> -- tool --help --json` does not.
    if (argv[i] === "--") {
      break;
    }
    i += scanHelpJsonToken(argv, i, scan);
  }

  if (!(scan.hasHelp && scan.hasJson)) {
    return null;
  }

  const rewritten = ["help", "--json", ...scan.commandPath];
  if (scan.fields !== undefined) {
    rewritten.push("--fields", scan.fields);
  }
  return rewritten;
}

/**
 * Normalize raw CLI argv before Stricli dispatch.
 *
 * Global-flag hoisting is handled inside Stricli's patched route scanner, so
 * this only covers the two application-boundary transforms Stricli can't do at
 * arbitrary route depth:
 *
 * 1. A flag-based `--help --json` request (see {@link rewriteHelpJsonRequest})
 *    is rewritten to the dedicated `help` command so JSON help works for the
 *    `--help` forms agents reach for (`sentry --help --json`,
 *    `sentry issue --help --json`), matching `sentry help --json`.
 * 2. A top-level `--version` (see {@link isVersionRequest}) is normalized to a
 *    plain `["--version"]` so the application-level version handler prints it
 *    regardless of how deep in the route tree it appeared.
 *
 * When neither applies, argv is returned unchanged for the scanner to handle.
 *
 * @param argv - Raw CLI arguments (e.g., `process.argv.slice(2)`)
 * @returns The argv to hand to Stricli's `run`
 */
export function preprocessArgv(argv: readonly string[]): string[] {
  const helpJson = rewriteHelpJsonRequest(argv);
  if (helpJson) {
    return helpJson;
  }
  if (isVersionRequest(argv)) {
    return ["--version"];
  }
  return [...argv];
}
