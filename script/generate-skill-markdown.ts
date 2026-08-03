/**
 * Markdown parsing helpers shared by the skill generator and its tests.
 */

/** Matches a generated command heading and stops before positional usage. */
const COMMAND_HEADING_RE =
  /^`sentry\s+([^<[`\s]+(?:\s+[^<[`\s]+)*)(?:\s*(?:<|\[)[^`]*)?`$/;

/** Extract the literal command path from a generated command heading. */
export function extractCommandPathFromHeading(
  heading: string
): string | undefined {
  const match = COMMAND_HEADING_RE.exec(heading);
  return match?.[1] ? `sentry ${match[1]}` : undefined;
}

/** Find the command whose literal path appears in a loose example block. */
export function matchExampleToCommand(
  code: string,
  commandPaths: readonly string[],
  groupFallback: string
): string | undefined {
  return (
    commandPaths.find((path) => code.includes(path)) ??
    (code.includes(groupFallback) ? groupFallback : undefined)
  );
}
