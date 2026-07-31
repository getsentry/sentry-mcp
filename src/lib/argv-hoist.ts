/**
 * Argv preprocessor that moves global flags to the end of the argument list.
 *
 * Stricli only parses flags at the leaf command level, so flags like
 * `--verbose` placed before the subcommand (`sentry --verbose issue list`)
 * fail route resolution. This module relocates known global flags from any
 * position to the tail of argv where Stricli's leaf-command parser can
 * find them.
 *
 * Flag metadata is derived from the shared {@link GLOBAL_FLAGS} definition
 * in `global-flags.ts` so both the hoisting preprocessor and the
 * `buildCommand` injection stay in sync automatically.
 */

import { GLOBAL_FLAGS } from "./global-flags.js";

/** Resolved flag metadata used by the hoisting algorithm. */
type HoistableFlag = {
  /** Long flag name without `--` prefix (e.g., `"verbose"`) */
  readonly name: string;
  /** Single-char short alias without `-` prefix, or `null` if none */
  readonly short: string | null;
  /** Whether the flag consumes the next token as its value */
  readonly takesValue: boolean;
  /** Whether `--no-<name>` is recognized as the negation form */
  readonly negatable: boolean;
};

/** Derive hoisting metadata from the shared flag definitions. */
const HOISTABLE_FLAGS: readonly HoistableFlag[] = GLOBAL_FLAGS.map((f) => ({
  name: f.name,
  short: f.short,
  takesValue: f.kind === "value",
  negatable: f.kind === "boolean",
}));

/** Pre-built lookup: long name → flag definition */
const FLAG_BY_NAME = new Map(HOISTABLE_FLAGS.map((f) => [f.name, f]));

/** Pre-built lookup: short alias → flag definition */
const FLAG_BY_SHORT = new Map(
  HOISTABLE_FLAGS.filter(
    (f): f is HoistableFlag & { short: string } => f.short !== null
  ).map((f) => [f.short, f])
);

/** Names that support `--no-<name>` negation */
const NEGATABLE_NAMES = new Set(
  HOISTABLE_FLAGS.filter((f) => f.negatable).map((f) => f.name)
);

/**
 * Flags whose values may start with `-`.
 *
 * Stricli treats a following token like `--format=x` as a separate flag, not
 * as the value of `--from`. Rewriting `--from --format=x` → `--from=--format=x`
 * lets the leaf parser pass the ref through to validation.
 */
const DASHED_VALUE_FLAGS = new Set(["from"]);

/**
 * Leaf flags on `release set-commits` that must not be swallowed as a `--from`
 * value when rewrite runs (only `--from` uses {@link DASHED_VALUE_FLAGS} today).
 */
const SET_COMMITS_FROM_NEIGHBOR_FLAGS = new Set([
  "auto",
  "local",
  "clear",
  "commit",
  "path",
  "from",
  "initial-depth",
]);

/** True when `token` is a registered global or set-commits leaf flag. */
function isRegisteredFlagToken(token: string): boolean {
  if (matchHoistable(token) !== null) {
    return true;
  }
  if (!token.startsWith("--")) {
    return false;
  }
  const eqIdx = token.indexOf("=");
  const name = eqIdx === -1 ? token.slice(2) : token.slice(2, eqIdx);
  return SET_COMMITS_FROM_NEIGHBOR_FLAGS.has(name);
}

/**
 * Match result from {@link matchHoistable}.
 *
 * - `"plain"`: `--flag` (boolean) or `--flag` (value-taking, value is next token)
 * - `"eq"`: `--flag=value` (value embedded in token)
 * - `"negated"`: `--no-flag`
 * - `"short"`: `-v` (single-char alias)
 */
type MatchForm = "plain" | "eq" | "negated" | "short";

/** Try matching a `--no-<name>` negation form. */
function matchNegated(
  name: string
): { flag: HoistableFlag; form: MatchForm } | null {
  if (!name.startsWith("no-")) {
    return null;
  }
  const baseName = name.slice(3);
  if (!NEGATABLE_NAMES.has(baseName)) {
    return null;
  }
  const flag = FLAG_BY_NAME.get(baseName);
  return flag ? { flag, form: "negated" } : null;
}

/**
 * Match a token against the hoistable flag registry.
 *
 * @returns The matched flag and form, or `null` if not hoistable.
 */
function matchHoistable(
  token: string
): { flag: HoistableFlag; form: MatchForm } | null {
  // Short alias: -v (exactly two chars, dash + letter)
  if (token.length === 2 && token[0] === "-" && token[1] !== "-") {
    const flag = FLAG_BY_SHORT.get(token[1] ?? "");
    return flag ? { flag, form: "short" } : null;
  }

  if (!token.startsWith("--")) {
    return null;
  }

  // --flag=value form
  const eqIdx = token.indexOf("=");
  if (eqIdx !== -1) {
    const name = token.slice(2, eqIdx);
    const flag = FLAG_BY_NAME.get(name);
    return flag?.takesValue ? { flag, form: "eq" } : null;
  }

  const name = token.slice(2);
  const negated = matchNegated(name);
  if (negated) {
    return negated;
  }
  const flag = FLAG_BY_NAME.get(name);
  return flag ? { flag, form: "plain" } : null;
}

/**
 * Hoist a single matched flag token (and its value if applicable) into the
 * `hoisted` array, advancing the index past the consumed tokens.
 *
 * Extracted from the main loop to keep {@link hoistGlobalFlags} under
 * Biome's cognitive complexity limit.
 */
function consumeFlag(
  argv: readonly string[],
  index: number,
  match: { flag: HoistableFlag; form: MatchForm },
  hoisted: string[]
): number {
  const token = argv[index] ?? "";

  // --flag=value or --no-flag: always a single token
  if (match.form === "eq" || match.form === "negated") {
    hoisted.push(token);
    return index + 1;
  }

  // --flag or -v: may consume a following value token
  if (match.flag.takesValue) {
    hoisted.push(token);
    const next = index + 1;
    if (next < argv.length) {
      hoisted.push(argv[next] ?? "");
      return next + 1;
    }
    // No value follows — the bare flag is still hoisted;
    // Stricli will report the missing value at parse time.
    return next;
  }

  // Boolean flag (--flag or -v): single token
  hoisted.push(token);
  return index + 1;
}

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
 * Move global flags from any position in argv to the end.
 *
 * Tokens after `--` are never touched. The relative order of both
 * hoisted and non-hoisted tokens is preserved.
 *
 * @param argv - Raw CLI arguments (e.g., `process.argv.slice(2)`)
 * @returns New array with global flags relocated to the tail
 */
export function hoistGlobalFlags(argv: readonly string[]): string[] {
  const remaining: string[] = [];
  const hoisted: string[] = [];
  /** Tokens from `--` onward (positional-only region). */
  const positionalTail: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const token = argv[i] ?? "";

    // Stop scanning at -- separator; pass everything through verbatim.
    // Hoisted flags must appear BEFORE -- so Stricli parses them as flags.
    if (token === "--") {
      for (let j = i; j < argv.length; j += 1) {
        positionalTail.push(argv[j] ?? "");
      }
      break;
    }

    const match = matchHoistable(token);
    if (match) {
      i = consumeFlag(argv, i, match, hoisted);
    } else {
      remaining.push(token);
      i += 1;
    }
  }

  return [...remaining, ...hoisted, ...positionalTail];
}

/**
 * Rewrite `--flag VALUE` as `--flag=VALUE` when `VALUE` looks like a long flag.
 *
 * Stricli's parser treats dashed tokens as flags, so `--from --format=x` fails
 * before the command sees the ref. Only unregistered `--`-prefixed tokens are
 * merged — registered global flags (`--json`) and set-commits leaf flags
 * (`--auto`) are left separate; short flags like `-v` are never merged. Git refs cannot start with `-` anyway; merged injection
 * attempts still reach our validation guard.
 *
 * Tokens after `--` are never touched.
 *
 * @param argv - Raw CLI arguments (e.g., `process.argv.slice(2)`)
 * @returns New array with eligible flag/value pairs collapsed to `--flag=value`
 */
export function rewriteDashedFlagValues(argv: readonly string[]): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const token = argv[i] ?? "";
    if (token === "--") {
      result.push(...argv.slice(i));
      break;
    }
    if (token.startsWith("--") && !token.includes("=")) {
      const name = token.slice(2);
      if (DASHED_VALUE_FLAGS.has(name)) {
        const next = argv[i + 1];
        if (
          next?.startsWith("--") &&
          next !== "--" &&
          !isRegisteredFlagToken(next)
        ) {
          result.push(`${token}=${next}`);
          i += 2;
          continue;
        }
      }
    }
    result.push(token);
    i += 1;
  }
  return result;
}

/**
 * Preprocess raw CLI argv before Stricli dispatch.
 *
 * Composes the argv transforms applied on every invocation:
 * 1. A top-level `--version` (see {@link isVersionRequest}) is normalized to a
 *    plain `["--version"]` so the application-level version handler prints it
 *    regardless of how deep in the route tree it appeared.
 * 2. Otherwise, dashed flag values are rewritten (see
 *    {@link rewriteDashedFlagValues}), then global flags are hoisted to the
 *    tail (see {@link hoistGlobalFlags}).
 *
 * Kept as a single entry point so callers apply one transform and stay under
 * the cognitive-complexity budget.
 *
 * @param argv - Raw CLI arguments (e.g., `process.argv.slice(2)`)
 * @returns The argv to hand to Stricli's `run`
 */
export function preprocessArgv(argv: readonly string[]): string[] {
  if (isVersionRequest(argv)) {
    return ["--version"];
  }
  return hoistGlobalFlags(rewriteDashedFlagValues(argv));
}
