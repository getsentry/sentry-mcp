/**
 * Fuzzy find-and-replace for applying code edits.
 *
 * Ported from opencode — 9 cascading strategies that try increasingly
 * relaxed matching so minor LLM imprecisions (whitespace, indentation,
 * escapes) don't cause failures.
 *
 * Source: https://github.com/anomalyco/opencode/blob/46f243fea71c65464471fcf1f5a807dd860c0f8f/packages/opencode/src/tool/edit.ts
 *
 * Pure string functions, zero external dependencies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Replacer = (
  content: string,
  find: string
) => Generator<string, void, unknown>;

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0;
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Top-level regexes (biome: useTopLevelRegex)
// ---------------------------------------------------------------------------

const WHITESPACE_RUN = /\s+/g;
const WHITESPACE_SPLIT = /\s+/;
const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;
const LEADING_WHITESPACE = /^(\s*)/;
const ESCAPE_SEQUENCES = /\\(n|t|r|'|"|`|\\|\n|\$)/g;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safe array index access — used throughout to satisfy strict null checks. */
function at<T>(arr: T[], idx: number): T {
  return arr[idx] as T;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: standard Levenshtein algorithm
function levenshtein(a: string, b: string): number {
  if (a === "" || b === "") {
    return Math.max(a.length, b.length);
  }
  const matrix: number[][] = [];
  for (let row = 0; row <= a.length; row += 1) {
    const cols: number[] = [];
    for (let col = 0; col <= b.length; col += 1) {
      if (row === 0) {
        cols.push(col);
      } else if (col === 0) {
        cols.push(row);
      } else {
        cols.push(0);
      }
    }
    matrix.push(cols);
  }

  for (let idx = 1; idx <= a.length; idx += 1) {
    for (let jdx = 1; jdx <= b.length; jdx += 1) {
      const cost = a[idx - 1] === b[jdx - 1] ? 0 : 1;
      at(matrix, idx)[jdx] = Math.min(
        at(at(matrix, idx - 1), jdx) + 1,
        at(at(matrix, idx), jdx - 1) + 1,
        at(at(matrix, idx - 1), jdx - 1) + cost
      );
    }
  }
  return at(at(matrix, a.length), b.length);
}

function lastItem(arr: string[]): string | undefined {
  return arr.at(-1);
}

/**
 * Extract a span of original lines as a substring of `content`.
 */
function extractSpan(
  content: string,
  originalLines: string[],
  startLine: number,
  endLine: number
): string {
  let matchStartIndex = 0;
  for (let k = 0; k < startLine; k += 1) {
    matchStartIndex += at(originalLines, k).length + 1;
  }
  let matchEndIndex = matchStartIndex;
  for (let k = startLine; k <= endLine; k += 1) {
    matchEndIndex += at(originalLines, k).length;
    if (k < endLine) {
      matchEndIndex += 1;
    }
  }
  return content.substring(matchStartIndex, matchEndIndex);
}

// ---------------------------------------------------------------------------
// Replacers — each yields candidate substrings from `content` that might
// correspond to `find`. The main `replace()` function checks uniqueness.
// ---------------------------------------------------------------------------

/** 1. Exact match — the happy path. */
export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find;
};

/** 2. Per-line trim comparison — handles indentation differences. */
export const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n");
  const searchLines = find.split("\n");

  if (lastItem(searchLines) === "") {
    searchLines.pop();
  }

  for (let i = 0; i <= originalLines.length - searchLines.length; i += 1) {
    let matches = true;

    for (let j = 0; j < searchLines.length; j += 1) {
      if (at(originalLines, i + j).trim() !== at(searchLines, j).trim()) {
        matches = false;
        break;
      }
    }

    if (matches) {
      yield extractSpan(content, originalLines, i, i + searchLines.length - 1);
    }
  }
};

/** 3. First/last line anchors + Levenshtein on middle lines. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported fuzzy matching algorithm
export const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n");
  const searchLines = find.split("\n");

  if (searchLines.length < 3) {
    return;
  }

  if (lastItem(searchLines) === "") {
    searchLines.pop();
  }

  const firstLineSearch = at(searchLines, 0).trim();
  const lastLineSearch = (lastItem(searchLines) ?? "").trim();
  const searchBlockSize = searchLines.length;

  const candidates: Array<{ startLine: number; endLine: number }> = [];
  for (let i = 0; i < originalLines.length; i += 1) {
    if (at(originalLines, i).trim() !== firstLineSearch) {
      continue;
    }
    for (let j = i + 2; j < originalLines.length; j += 1) {
      if (at(originalLines, j).trim() === lastLineSearch) {
        candidates.push({ startLine: i, endLine: j });
        break;
      }
    }
  }

  if (candidates.length === 0) {
    return;
  }

  function middleSimilarity(startLine: number, endLine: number): number {
    const actualBlockSize = endLine - startLine + 1;
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2);

    if (linesToCheck <= 0) {
      return 1.0;
    }

    let similarity = 0;
    for (
      let j = 1;
      j < searchBlockSize - 1 && j < actualBlockSize - 1;
      j += 1
    ) {
      const originalLine = at(originalLines, startLine + j).trim();
      const searchLine = at(searchLines, j).trim();
      const maxLen = Math.max(originalLine.length, searchLine.length);
      if (maxLen === 0) {
        continue;
      }
      const distance = levenshtein(originalLine, searchLine);
      similarity += 1 - distance / maxLen;
    }
    return similarity / linesToCheck;
  }

  if (candidates.length === 1) {
    const { startLine, endLine } = at(candidates, 0);
    if (
      middleSimilarity(startLine, endLine) >=
      SINGLE_CANDIDATE_SIMILARITY_THRESHOLD
    ) {
      yield extractSpan(content, originalLines, startLine, endLine);
    }
    return;
  }

  let bestMatch: (typeof candidates)[0] | null = null;
  let maxSimilarity = -1;

  for (const candidate of candidates) {
    const sim = middleSimilarity(candidate.startLine, candidate.endLine);
    if (sim > maxSimilarity) {
      maxSimilarity = sim;
      bestMatch = candidate;
    }
  }

  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    yield extractSpan(
      content,
      originalLines,
      bestMatch.startLine,
      bestMatch.endLine
    );
  }
};

/** 4. Collapse whitespace runs into single space before comparing. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported fuzzy matching algorithm
export const WhitespaceNormalizedReplacer: Replacer = function* (
  content,
  find
) {
  const normalizeWhitespace = (text: string) =>
    text.replace(WHITESPACE_RUN, " ").trim();
  const normalizedFind = normalizeWhitespace(find);

  const lines = content.split("\n");
  for (const line of lines) {
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line;
    } else {
      const normalizedLine = normalizeWhitespace(line);
      if (normalizedLine.includes(normalizedFind)) {
        const words = find.trim().split(WHITESPACE_SPLIT);
        if (words.length > 0) {
          const pattern = words
            .map((word) => word.replace(REGEX_SPECIAL_CHARS, "\\$&"))
            .join("\\s+");
          try {
            const regex = new RegExp(pattern);
            const match = line.match(regex);
            if (match) {
              yield match[0];
            }
          } catch {
            // skip
          }
        }
      }
    }
  }

  const findLines = find.split("\n");
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i += 1) {
      const block = lines.slice(i, i + findLines.length);
      if (normalizeWhitespace(block.join("\n")) === normalizedFind) {
        yield block.join("\n");
      }
    }
  }
};

/** 5. Strip common leading indentation, then compare. */
export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndentation = (text: string) => {
    const textLines = text.split("\n");
    const nonEmptyLines = textLines.filter((line) => line.trim().length > 0);
    if (nonEmptyLines.length === 0) {
      return text;
    }

    const minIndent = Math.min(
      ...nonEmptyLines.map((line) => {
        const match = line.match(LEADING_WHITESPACE);
        return match?.[1]?.length ?? 0;
      })
    );

    return textLines
      .map((line) => {
        if (line.trim().length === 0) {
          return line;
        }
        return line.slice(minIndent);
      })
      .join("\n");
  };

  const normalizedFind = removeIndentation(find);
  const contentLines = content.split("\n");
  const findLines = find.split("\n");

  for (let i = 0; i <= contentLines.length - findLines.length; i += 1) {
    const block = contentLines.slice(i, i + findLines.length).join("\n");
    if (removeIndentation(block) === normalizedFind) {
      yield block;
    }
  }
};

/** 6. Unescape common escape sequences before comparing. */
export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  function unescapeString(str: string): string {
    return str.replace(ESCAPE_SEQUENCES, (match, capturedChar) => {
      switch (capturedChar) {
        case "n":
          return "\n";
        case "t":
          return "\t";
        case "r":
          return "\r";
        case "'":
          return "'";
        case '"':
          return '"';
        case "`":
          return "`";
        case "\\":
          return "\\";
        case "\n":
          return "\n";
        case "$":
          return "$";
        default:
          return match;
      }
    });
  }

  const unescapedFind = unescapeString(find);

  if (content.includes(unescapedFind)) {
    yield unescapedFind;
  }

  const lines = content.split("\n");
  const findLines = unescapedFind.split("\n");

  for (let i = 0; i <= lines.length - findLines.length; i += 1) {
    const block = lines.slice(i, i + findLines.length).join("\n");
    if (unescapeString(block) === unescapedFind) {
      yield block;
    }
  }
};

/** 7. Trim leading/trailing whitespace from the search string. */
export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmedFind = find.trim();

  if (trimmedFind === find) {
    return;
  }

  if (content.includes(trimmedFind)) {
    yield trimmedFind;
  }

  const lines = content.split("\n");
  const findLines = find.split("\n");

  for (let i = 0; i <= lines.length - findLines.length; i += 1) {
    const block = lines.slice(i, i + findLines.length).join("\n");
    if (block.trim() === trimmedFind) {
      yield block;
    }
  }
};

/** 8. Anchor on first+last line (trimmed), accept if >=50% middles match. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported fuzzy matching algorithm
export const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split("\n");
  if (findLines.length < 3) {
    return;
  }

  if (lastItem(findLines) === "") {
    findLines.pop();
  }

  const contentLines = content.split("\n");
  const firstLine = at(findLines, 0).trim();
  const lastLine = (lastItem(findLines) ?? "").trim();

  for (let i = 0; i < contentLines.length; i += 1) {
    if (at(contentLines, i).trim() !== firstLine) {
      continue;
    }

    for (let j = i + 2; j < contentLines.length; j += 1) {
      if (at(contentLines, j).trim() !== lastLine) {
        continue;
      }

      const blockLines = contentLines.slice(i, j + 1);
      const block = blockLines.join("\n");

      if (blockLines.length === findLines.length) {
        let matchingLines = 0;
        let totalNonEmptyLines = 0;

        for (let k = 1; k < blockLines.length - 1; k += 1) {
          const blockLine = at(blockLines, k).trim();
          const findLine = at(findLines, k).trim();

          if (blockLine.length > 0 || findLine.length > 0) {
            totalNonEmptyLines += 1;
            if (blockLine === findLine) {
              matchingLines += 1;
            }
          }
        }

        if (
          totalNonEmptyLines === 0 ||
          matchingLines / totalNonEmptyLines >= 0.5
        ) {
          yield block;
          break;
        }
      }
      break;
    }
  }
};

/** 9. Yield every exact match (used with replaceAll). */
export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  let startIndex = 0;

  for (;;) {
    const index = content.indexOf(find, startIndex);
    if (index === -1) {
      break;
    }

    yield find;
    startIndex = index + find.length;
  }
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const REPLACERS: Replacer[] = [
  SimpleReplacer,
  LineTrimmedReplacer,
  BlockAnchorReplacer,
  WhitespaceNormalizedReplacer,
  IndentationFlexibleReplacer,
  EscapeNormalizedReplacer,
  TrimmedBoundaryReplacer,
  ContextAwareReplacer,
  MultiOccurrenceReplacer,
];

/**
 * Find `oldString` in `content` using cascading fuzzy strategies and replace
 * it with `newString`. Throws if no match is found or if the match is
 * ambiguous (multiple occurrences without `replaceAll`).
 */
export function replace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false
): string {
  if (oldString === newString) {
    return content;
  }

  let notFound = true;

  for (const replacer of REPLACERS) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search);
      if (index === -1) {
        continue;
      }
      notFound = false;
      if (replaceAll) {
        return content.replaceAll(search, newString);
      }
      const lastIndex = content.lastIndexOf(search);
      if (index !== lastIndex) {
        continue;
      }
      return (
        content.substring(0, index) +
        newString +
        content.substring(index + search.length)
      );
    }
  }

  if (notFound) {
    throw new Error(
      "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings."
    );
  }
  throw new Error(
    "Found multiple matches for oldString. Provide more surrounding context to make the match unique."
  );
}
