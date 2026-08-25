#!/usr/bin/env tsx
/**
 * Check for Error Class Misuse Patterns
 *
 * Scans source files for common anti-patterns in error class usage:
 *
 * 1. `new ContextError(resource, command)` where command contains `\n`
 *    → Should use ResolutionError for resolution failures
 *
 * 2. `new CliError(... "Try:" ...)` — ad-hoc "Try:" strings
 *    → Should use ResolutionError with structured hint/suggestions
 *
 * 3. Silent catch blocks — `catch { ... }` whose body has no logging, no
 *    re-throw, and at most a bare `return`. Errors must be surfaced via
 *    `log.debug`/`log.warn` (or re-thrown) per AGENTS.md. Biome's
 *    `noEmptyBlockStatements` only catches syntactically empty `catch {}`;
 *    this catches comment-only and return-only blocks too.
 *
 * Silent catches are enforced with a **ratchet baseline**
 * (`silent-catch-baseline.json`): the repo has a pre-existing backlog of
 * best-effort catches (UI teardown, cleanup paths, etc.). The baseline records
 * the known per-file count so that:
 *   - a *new* silent catch (a file exceeding its baseline, or a file absent from
 *     the baseline) fails CI, and
 *   - removing silent catches without lowering the baseline also fails CI, so
 *     the backlog can only shrink.
 * Run with `--update` to regenerate the baseline after intentionally changing
 * the set of silent catches.
 *
 * Usage:
 *   tsx script/check-error-patterns.ts            # check (fails CI on drift)
 *   tsx script/check-error-patterns.ts --update   # rewrite the baseline
 *
 * Exit codes:
 *   0 - No anti-patterns found and silent-catch baseline is in sync
 *   1 - Anti-patterns detected or silent-catch baseline drifted
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "tinyglobby";

export type Violation = { file: string; line: number; message: string };

/** Per-file count of grandfathered silent catch blocks. */
export type SilentCatchBaseline = Record<string, number>;

const CONTEXT_ERROR_RE = /new ContextError\(/g;
const TRY_PATTERN_RE = /["'`]Try:/;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const BASELINE_PATH = join(SCRIPT_DIR, "silent-catch-baseline.json");

/** Characters that open a nesting level in JavaScript source. */
function isOpener(ch: string): boolean {
  return ch === "(" || ch === "[" || ch === "{";
}

/** Characters that close a nesting level in JavaScript source. */
function isCloser(ch: string): boolean {
  return ch === ")" || ch === "]" || ch === "}";
}

/** Characters that start a string literal in JavaScript source. */
function isQuote(ch: string): boolean {
  return ch === '"' || ch === "'" || ch === "`";
}

/**
 * Skip past a `${...}` expression inside a template literal.
 * @param content - Full source text
 * @param start - Index right after the `{` in `${`
 * @returns Index right after the closing `}`
 */
function skipTemplateExpression(content: string, start: number): number {
  let braceDepth = 1;
  let i = start;
  while (i < content.length && braceDepth > 0) {
    const ec = content[i];
    if (ec === "\\") {
      i += 2;
    } else if (ec === "`") {
      i = skipTemplateLiteral(content, i + 1);
    } else if (ec === "{") {
      braceDepth += 1;
      i += 1;
    } else if (ec === "}") {
      braceDepth -= 1;
      i += 1;
    } else {
      i += 1;
    }
  }
  return i;
}

/**
 * Skip past a template literal, handling nested `${...}` expressions.
 * @param content - Full source text
 * @param start - Index right after the opening backtick
 * @returns Index right after the closing backtick
 */
function skipTemplateLiteral(content: string, start: number): number {
  let i = start;
  while (i < content.length) {
    const ch = content[i];
    if (ch === "\\") {
      i += 2;
    } else if (ch === "`") {
      return i + 1;
    } else if (ch === "$" && content[i + 1] === "{") {
      i = skipTemplateExpression(content, i + 2);
    } else {
      i += 1;
    }
  }
  return i;
}

/**
 * Advance past a string literal (single-quoted, double-quoted, or template).
 * @param content - Full source text
 * @param start - Index of the opening quote character
 * @returns Index right after the closing quote
 */
function skipString(content: string, start: number): number {
  const quote = content[start];
  if (quote === "`") {
    return skipTemplateLiteral(content, start + 1);
  }
  let i = start + 1;
  while (i < content.length) {
    const ch = content[i];
    if (ch === "\\") {
      i += 2;
    } else if (ch === quote) {
      return i + 1;
    } else {
      i += 1;
    }
  }
  return i;
}

/**
 * Advance one token in JS source, skipping strings as atomic units.
 * @returns The next index and the character at position `i` (or the string span's first char).
 */
function advanceToken(
  content: string,
  i: number
): { next: number; ch: string } {
  const ch = content[i] ?? "";
  if (isQuote(ch)) {
    return { next: skipString(content, i), ch };
  }
  return { next: i + 1, ch };
}

/**
 * Walk from `startIdx` (just inside the opening `(`) to find the matching `)`,
 * tracking commas at depth 1.
 * @returns The index of the first comma (between arg1 and arg2) and the closing paren index.
 */
function findCallBounds(
  content: string,
  startIdx: number
): { commaIdx: number; closingIdx: number } | null {
  let depth = 1;
  let commaCount = 0;
  let commaIdx = -1;
  let i = startIdx;

  while (i < content.length && depth > 0) {
    const { next, ch } = advanceToken(content, i);
    if (isOpener(ch)) {
      depth += 1;
    } else if (isCloser(ch)) {
      depth -= 1;
    } else if (ch === "," && depth === 1) {
      commaCount += 1;
      if (commaCount === 1) {
        commaIdx = i;
      }
    }
    i = next;
  }

  if (commaIdx === -1) {
    return null;
  }
  return { commaIdx, closingIdx: i - 1 };
}

/**
 * Extract the second argument of a `new ContextError(...)` call from source text.
 * Properly handles template literals so backticks don't break depth tracking.
 * @returns The raw source text of the second argument, or null if not found.
 */
function extractSecondArg(content: string, startIdx: number): string | null {
  const bounds = findCallBounds(content, startIdx);
  if (!bounds) {
    return null;
  }

  const { commaIdx, closingIdx } = bounds;

  // Find end of second arg: next comma at depth 1 or closing paren
  let endIdx = closingIdx;
  let d = 1;
  for (let j = commaIdx + 1; j < closingIdx; j += 1) {
    const { next, ch } = advanceToken(content, j);
    if (isOpener(ch)) {
      d += 1;
    } else if (isCloser(ch)) {
      d -= 1;
    } else if (ch === "," && d === 1) {
      endIdx = j;
      break;
    }
    // advanceToken may skip multiple chars (strings), adjust loop var
    j = next - 1; // -1 because for-loop increments
  }

  return content.slice(commaIdx + 1, endIdx).trim();
}

/**
 * Detect `new ContextError(` where the second argument contains `\n`.
 * This catches resolution-failure prose stuffed into the command parameter.
 */
export function findContextErrorNewlines(
  content: string,
  filePath: string
): Violation[] {
  const found: Violation[] = [];
  let match = CONTEXT_ERROR_RE.exec(content);
  while (match !== null) {
    const startIdx = match.index + match[0].length;
    const secondArg = extractSecondArg(content, startIdx);

    if (secondArg?.includes("\\n")) {
      const line = content.slice(0, match.index).split("\n").length;
      found.push({
        file: filePath,
        line,
        message:
          "ContextError command contains '\\n'. Use ResolutionError for multi-line resolution failures.",
      });
    }
    match = CONTEXT_ERROR_RE.exec(content);
  }
  return found;
}

/**
 * Detect `new CliError(... "Try:" ...)` — ad-hoc "Try:" strings that bypass
 * the structured ResolutionError pattern.
 */
export function findAdHocTryPatterns(
  content: string,
  filePath: string
): Violation[] {
  const found: Violation[] = [];
  const lines = content.split("\n");
  let inCliError = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.includes("new CliError(")) {
      inCliError = true;
    }
    if (inCliError && TRY_PATTERN_RE.test(line)) {
      found.push({
        file: filePath,
        line: i + 1,
        message:
          'CliError contains "Try:" — use ResolutionError with structured hint/suggestions instead.',
      });
      inCliError = false;
    }
    // Reset after a reasonable window (closing paren)
    if (inCliError && line.includes(");")) {
      inCliError = false;
    }
  }
  return found;
}

/** Matches the start of a catch block in both statement and promise form. */
const CATCH_RE =
  /\bcatch\s*(?:\(\s*(\w+)[^)]*\)\s*)?\{|\.catch\(\s*(?:\(\s*(\w+)[^)]*\)|(\w+))\s*=>\s*\{/g;

/** Tokens inside a catch body that prove the error is surfaced (not silenced). */
const SURFACING_RE =
  /\b(?:log|logger|console)\s*\.|[^.]\bthrow\b|captureException|reportError/;

/** A catch body consisting solely of a single `return ...;` statement. */
const RETURN_ONLY_RE = /^return\b[^;]*;?$/;

/**
 * Return the source of a balanced `{...}` block given the index of its opening
 * brace, skipping strings so braces inside literals don't break depth tracking.
 */
function readBlock(content: string, openBraceIdx: number): string {
  let depth = 0;
  let i = openBraceIdx;
  while (i < content.length) {
    const { next, ch } = advanceToken(content, i);
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(openBraceIdx + 1, i);
      }
    }
    i = next;
  }
  return content.slice(openBraceIdx + 1);
}

/**
 * Strip line and block comments from a snippet so comment-only catch bodies are
 * treated as empty.
 */
function stripComments(snippet: string): string {
  return snippet.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Detect silent catch blocks: catch bodies that, after removing comments, are
 * empty or contain only a bare `return;`/`return <value>;` with no logging or
 * re-throw. These hide errors and violate the AGENTS.md no-silent-catch rule.
 */
export function findSilentCatches(
  content: string,
  filePath: string
): Violation[] {
  const found: Violation[] = [];
  let match = CATCH_RE.exec(content);
  while (match !== null) {
    const openBraceIdx = match.index + match[0].length - 1;
    const errorParam = match[1] ?? match[2] ?? match[3];
    const body = readBlock(content, openBraceIdx);
    const code = stripComments(body).trim();
    // A body that references the caught error identifier (forwarding it to a
    // handler, attaching it, etc.) is not "silent" even if it lacks an explicit
    // log/throw — avoids false positives like `return handleFetchError(error)`.
    const usesError =
      errorParam !== undefined && new RegExp(`\\b${errorParam}\\b`).test(code);
    const returnOnly = RETURN_ONLY_RE.test(code);
    const silent =
      !(SURFACING_RE.test(code) || usesError) &&
      (code.length === 0 || returnOnly);
    if (silent) {
      const line = content.slice(0, match.index).split("\n").length;
      found.push({
        file: filePath,
        line,
        message:
          "Silent catch block. Add log.debug()/log.warn() or re-throw — errors must not vanish (AGENTS.md).",
      });
    }
    match = CATCH_RE.exec(content);
  }
  return found;
}

export type ScanResult = {
  /** Hard violations — always fail CI. */
  violations: Violation[];
  /** Every silent catch found, across all scanned files. */
  silentCatches: Violation[];
};

/** Scan the given files and collect violations and silent catches. */
export async function scanFiles(files: string[]): Promise<ScanResult> {
  const violations: Violation[] = [];
  const silentCatches: Violation[] = [];
  for (const filePath of files) {
    const content = await readFile(filePath, "utf-8");
    violations.push(...findContextErrorNewlines(content, filePath));
    violations.push(...findAdHocTryPatterns(content, filePath));
    silentCatches.push(...findSilentCatches(content, filePath));
  }
  return { violations, silentCatches };
}

/** Group silent catches into a per-file count map. */
export function countByFile(silentCatches: Violation[]): SilentCatchBaseline {
  const counts: SilentCatchBaseline = {};
  for (const v of silentCatches) {
    counts[v.file] = (counts[v.file] ?? 0) + 1;
  }
  return counts;
}

export type BaselineDrift = {
  /** Files with more silent catches than the baseline allows (or new files). */
  regressions: { file: string; baseline: number; actual: number }[];
  /** Files with fewer silent catches than the baseline records. */
  improvements: { file: string; baseline: number; actual: number }[];
};

/**
 * Compare the current per-file silent-catch counts against the committed
 * baseline. A regression (new silent catch) always fails CI. An improvement
 * (silent catch removed without updating the baseline) also fails so the
 * baseline stays honest and can only ratchet down.
 */
export function compareToBaseline(
  actual: SilentCatchBaseline,
  baseline: SilentCatchBaseline
): BaselineDrift {
  const regressions: BaselineDrift["regressions"] = [];
  const improvements: BaselineDrift["improvements"] = [];
  const files = new Set([...Object.keys(actual), ...Object.keys(baseline)]);
  for (const file of files) {
    const a = actual[file] ?? 0;
    const b = baseline[file] ?? 0;
    if (a > b) {
      regressions.push({ file, baseline: b, actual: a });
    } else if (a < b) {
      improvements.push({ file, baseline: b, actual: a });
    }
  }
  regressions.sort((x, y) => x.file.localeCompare(y.file));
  improvements.sort((x, y) => x.file.localeCompare(y.file));
  return { regressions, improvements };
}

/** Load the committed baseline, treating a missing file as an empty baseline. */
async function loadBaseline(): Promise<SilentCatchBaseline> {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, "utf-8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

/** Serialize the baseline with stable key ordering and a trailing newline. */
function serializeBaseline(counts: SilentCatchBaseline): string {
  const sorted: SilentCatchBaseline = {};
  for (const key of Object.keys(counts).sort()) {
    sorted[key] = counts[key] as number;
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

async function main(): Promise<void> {
  const update = process.argv.includes("--update");
  const files = await glob("src/**/*.ts");
  const { violations, silentCatches } = await scanFiles(files);
  const actual = countByFile(silentCatches);

  if (update) {
    await writeFile(BASELINE_PATH, serializeBaseline(actual));
    const total = silentCatches.length;
    console.log(
      `✓ Wrote silent-catch baseline: ${total} catch(es) across ${Object.keys(actual).length} file(s).`
    );
  }

  const baseline = update ? actual : await loadBaseline();
  const { regressions, improvements } = compareToBaseline(actual, baseline);

  let failed = false;

  if (violations.length > 0) {
    failed = true;
    console.error(
      `✗ Found ${violations.length} error class anti-pattern(s):\n`
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    ${v.message}\n`);
    }
    console.error(
      "Fix: Use ResolutionError for resolution failures, ValidationError for input errors."
    );
    console.error(
      "See ContextError JSDoc in src/lib/errors.ts for usage guidance.\n"
    );
  }

  if (regressions.length > 0) {
    failed = true;
    const added = regressions.reduce((n, r) => n + (r.actual - r.baseline), 0);
    console.error(
      `✗ ${added} new silent catch block(s) beyond the baseline:\n`
    );
    for (const r of regressions) {
      console.error(`  ${r.file}: ${r.baseline} → ${r.actual}`);
    }
    console.error(
      "\nEvery catch must re-throw, log.debug()/log.warn(), or return a fallback " +
        "with a log.debug() explaining the suppression (AGENTS.md)."
    );
    console.error(
      "If a silent catch is truly intentional, run `pnpm run check:errors -- --update`.\n"
    );
  }

  if (improvements.length > 0) {
    failed = true;
    const removed = improvements.reduce(
      (n, r) => n + (r.baseline - r.actual),
      0
    );
    console.error(
      `✗ ${removed} silent catch block(s) removed but the baseline is stale:\n`
    );
    for (const r of improvements) {
      console.error(`  ${r.file}: ${r.baseline} → ${r.actual}`);
    }
    console.error(
      "\nNice — the backlog shrank. Lock it in with `pnpm run check:errors -- --update`.\n"
    );
  }

  if (failed) {
    process.exit(1);
  }

  const total = silentCatches.length;
  console.log(
    `✓ No error class anti-patterns found (silent-catch baseline: ${total} grandfathered).`
  );
  process.exit(0);
}

// Only run when invoked directly, not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
