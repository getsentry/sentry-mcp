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
 * Usage:
 *   tsx script/check-error-patterns.ts
 *
 * Exit codes:
 *   0 - No anti-patterns found
 *   1 - Anti-patterns detected
 */

import { readFile } from "node:fs/promises";
import { glob } from "tinyglobby";

type Violation = { file: string; line: number; message: string };

const CONTEXT_ERROR_RE = /new ContextError\(/g;
const TRY_PATTERN_RE = /["'`]Try:/;

const files = await glob("src/**/*.ts");

/** Hard violations — these fail CI. */
const violations: Violation[] = [];

/**
 * Advisory silent-catch findings. Reported as warnings but do NOT fail CI yet:
 * the repo has a pre-existing backlog of intentional best-effort catches (e.g.
 * UI teardown, cleanup paths). The check surfaces them for incremental cleanup
 * and so new ones are visible in review. Set SENTRY_STRICT_SILENT_CATCH=1 to
 * promote them to hard failures once the backlog is cleared.
 */
const silentCatchWarnings: Violation[] = [];
const STRICT_SILENT_CATCH = process.env.SENTRY_STRICT_SILENT_CATCH === "1";

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
function checkContextErrorNewlines(content: string, filePath: string): void {
  let match = CONTEXT_ERROR_RE.exec(content);
  while (match !== null) {
    const startIdx = match.index + match[0].length;
    const secondArg = extractSecondArg(content, startIdx);

    if (secondArg?.includes("\\n")) {
      const line = content.slice(0, match.index).split("\n").length;
      violations.push({
        file: filePath,
        line,
        message:
          "ContextError command contains '\\n'. Use ResolutionError for multi-line resolution failures.",
      });
    }
    match = CONTEXT_ERROR_RE.exec(content);
  }
}

/**
 * Detect `new CliError(... "Try:" ...)` — ad-hoc "Try:" strings that bypass
 * the structured ResolutionError pattern.
 */
function checkAdHocTryPatterns(content: string, filePath: string): void {
  const lines = content.split("\n");
  let inCliError = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.includes("new CliError(")) {
      inCliError = true;
    }
    if (inCliError && TRY_PATTERN_RE.test(line)) {
      violations.push({
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
function checkSilentCatch(content: string, filePath: string): void {
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
      const target = STRICT_SILENT_CATCH ? violations : silentCatchWarnings;
      target.push({
        file: filePath,
        line,
        message:
          "Silent catch block. Add log.debug()/log.warn() or re-throw — errors must not vanish (AGENTS.md).",
      });
    }
    match = CATCH_RE.exec(content);
  }
}

for (const filePath of files) {
  const content = await readFile(filePath, "utf-8");
  checkContextErrorNewlines(content, filePath);
  checkAdHocTryPatterns(content, filePath);
  checkSilentCatch(content, filePath);
}

if (silentCatchWarnings.length > 0) {
  console.warn(
    `⚠ ${silentCatchWarnings.length} silent catch block(s) found (advisory; not failing CI).`
  );
  console.warn(
    "  Add log.debug()/log.warn() or re-throw. Run with SENTRY_STRICT_SILENT_CATCH=1 to enforce.\n"
  );
  for (const v of silentCatchWarnings) {
    console.warn(`  ${v.file}:${v.line}`);
  }
  console.warn("");
}

if (violations.length === 0) {
  console.log("✓ No error class anti-patterns found");
  process.exit(0);
}

console.error(`✗ Found ${violations.length} error class anti-pattern(s):\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.message}\n`);
}
console.error(
  "Fix: Use ResolutionError for resolution failures, ValidationError for input errors."
);
console.error(
  "See ContextError JSDoc in src/lib/errors.ts for usage guidance."
);

process.exit(1);
