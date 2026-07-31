/**
 * Custom Help Output
 *
 * Provides a branded, styled help output for the CLI.
 * Shows custom formatting when running `sentry` with no arguments.
 * Commands are auto-generated from Stricli's route structure.
 */

import { routes } from "../app.js";
import { formatBanner } from "./banner.js";
import { isAuthenticated } from "./db/auth.js";
import { TOP_LEVEL_ENV_VARS } from "./env-registry.js";
import { cyan, magenta, muted } from "./formatters/colors.js";
import {
  type CommandInfo,
  extractAllRoutes,
  getPositionalString,
  isCommand,
  isRouteMap,
  type RouteInfo,
  type RouteMap,
  type RouteMapEntry,
  resolveCommandPath,
} from "./introspect.js";
import { sixelBanner } from "./sixel.js";

const TAGLINE = "The command-line interface for Sentry";

type HelpCommand = {
  usage: string;
  description: string;
};

// ---------------------------------------------------------------------------
// Common flags — surfaced in the branded `sentry --help` output
// ---------------------------------------------------------------------------

/**
 * Metadata for a flag shown in the top-level help.
 *
 * Only the highest-signal flags belong here — per-command flags are
 * documented in each command's own `--help`.
 */
type CommonFlagEntry = {
  /** Long flag name with `--` prefix (e.g., `"--json"`). */
  long: string;
  /** Short alias with `-` prefix, or `undefined` if none. */
  short?: string;
  /** One-line description for the branded help. */
  description: string;
};

/**
 * Flags surfaced in the branded `sentry` help output.
 *
 * Includes both truly global flags (injected into every command) and
 * widely-used flags present on most list/view commands.
 */
const COMMON_FLAGS: readonly CommonFlagEntry[] = [
  {
    long: "--json",
    description: "Output as JSON (with --fields to select)",
  },
  {
    long: "--fresh",
    short: "-f",
    description: "Bypass cache and fetch fresh data",
  },
  {
    long: "--verbose",
    short: "-v",
    description: "Enable debug logging",
  },
  {
    long: "--help",
    description: "Show help for a command",
  },
  {
    long: "--version",
    description: "Show version",
  },
];

/**
 * Generate the commands list dynamically from Stricli's route structure.
 * This ensures help text stays in sync with actual registered commands.
 */
function generateCommands(): HelpCommand[] {
  // Cast to our introspection types — Stricli's generic types are compatible
  const routeMap = routes as unknown as RouteMap;
  const entries = routeMap.getAllEntries();

  return entries
    .filter((entry: RouteMapEntry) => !entry.hidden)
    .map((entry: RouteMapEntry) => {
      const routeName = entry.name.original;
      const brief = entry.target.brief;

      if (isRouteMap(entry.target)) {
        // Get visible subcommand names and join with pipes
        const subEntries = entry.target
          .getAllEntries()
          .filter((sub: RouteMapEntry) => !sub.hidden);
        const subNames = subEntries
          .map((sub: RouteMapEntry) => sub.name.original)
          .join(" | ");
        return {
          usage: `sentry ${routeName} ${subNames}`,
          description: brief,
        };
      }

      // Direct command - extract placeholder from positional parameters
      if (isCommand(entry.target)) {
        const placeholder = getPositionalString(
          entry.target.parameters.positional
        );
        const usageSuffix = placeholder ? ` ${placeholder}` : "";
        return {
          usage: `sentry ${routeName}${usageSuffix}`,
          description: brief,
        };
      }

      return {
        usage: `sentry ${routeName}`,
        description: brief,
      };
    });
}

const EXAMPLE_LOGGED_OUT = "sentry auth login";
const EXAMPLE_LOGGED_IN = "sentry issue list";
const DOCS_URL = "https://cli.sentry.dev/getting-started/";

/**
 * Format the command list with aligned descriptions.
 *
 * @param commands - Array of commands to format
 * @returns Formatted string with aligned columns
 */
function formatCommands(commands: HelpCommand[]): string {
  const maxUsageLength = Math.max(...commands.map((cmd) => cmd.usage.length));
  const padding = 4;

  return commands
    .map((cmd) => {
      const usagePadded = cmd.usage.padEnd(maxUsageLength + padding);
      return `    $ ${cyan(usagePadded)}${muted(cmd.description)}`;
    })
    .join("\n");
}

/**
 * Format the common flags list with aligned descriptions.
 *
 * Renders flag names (with optional short alias) left-aligned and
 * descriptions right-aligned, styled identically to the env-var section.
 */
function formatCommonFlags(): string {
  if (COMMON_FLAGS.length === 0) {
    return "";
  }
  const padding = 4;
  const labels = COMMON_FLAGS.map((f) =>
    f.short ? `${f.short}, ${f.long}` : `    ${f.long}`
  );
  const maxLabelLength = Math.max(...labels.map((l) => l.length));
  return COMMON_FLAGS.map((f, i) => {
    const labelPadded = (labels[i] ?? "").padEnd(maxLabelLength + padding);
    return `    ${cyan(labelPadded)}${muted(f.description)}`;
  }).join("\n");
}

/**
 * Format the top-level environment variable list with aligned descriptions.
 *
 * Source of truth: `TOP_LEVEL_ENV_VARS` in `env-registry.ts`. Keep this
 * short — full docs live under `configuration.md`.
 */
function formatEnvVars(): string {
  if (TOP_LEVEL_ENV_VARS.length === 0) {
    return "";
  }
  const padding = 4;
  const maxNameLength = Math.max(
    ...TOP_LEVEL_ENV_VARS.map((v) => v.name.length)
  );
  return TOP_LEVEL_ENV_VARS.map((v) => {
    const namePadded = v.name.padEnd(maxNameLength + padding);
    const desc = v.briefDescription ?? v.description.split("\n")[0] ?? "";
    return `    ${cyan(namePadded)}${muted(desc)}`;
  }).join("\n");
}

/**
 * Build the custom branded help output string.
 * Shows a contextual example based on authentication status.
 */
export function printCustomHelp(): string {
  const loggedIn = isAuthenticated();
  const example = loggedIn ? EXAMPLE_LOGGED_IN : EXAMPLE_LOGGED_OUT;

  const lines: string[] = [];

  // Skip banner for non-TTY to avoid wasting tokens in agent loops
  if (process.stdout.isTTY) {
    const cols = process.stdout.columns ?? 80;
    // Prefer a real sixel image on capable terminals; otherwise fall back to the
    // block-art banner sized to the terminal width (returns "" only when the
    // terminal is too narrow for even the compact mark).
    const banner = sixelBanner(cols) ?? formatBanner(cols);
    if (banner) {
      lines.push("");
      lines.push(banner);
      lines.push("");
    }
  }

  // Tagline
  lines.push(`  ${TAGLINE}`);
  lines.push("");

  // Commands (auto-generated from Stricli routes)
  lines.push(formatCommands(generateCommands()));
  lines.push("");

  // Common flags
  const flags = formatCommonFlags();
  if (flags) {
    lines.push(`  ${muted("Flags:")}`);
    lines.push(flags);
    lines.push("");
  }

  // Environment variables (auto-generated from env-registry)
  const envVars = formatEnvVars();
  if (envVars) {
    lines.push(`  ${muted("Environment Variables:")}`);
    lines.push(envVars);
    lines.push("");
  }

  // Example
  lines.push(`  ${muted("try:")} ${magenta(example)}`);
  lines.push("");

  // Footer
  lines.push(`  ${muted(`Learn more at ${DOCS_URL}`)}`);
  lines.push("");
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Introspection (for `sentry help --json` and human rendering)
// ---------------------------------------------------------------------------

/**
 * Metadata for a top-level environment variable as exposed to JSON callers
 * of `sentry help --json`.
 */
export type HelpEnvVarInfo = {
  /** Variable name (e.g. `SENTRY_AUTH_TOKEN`). */
  name: string;
  /** Short one-line description suitable for list display. */
  brief: string;
  /** Full markdown description from the env-var registry. */
  description: string;
  /** Example value (when provided in the registry). */
  example?: string;
  /** Default value (when provided in the registry). */
  defaultValue?: string;
};

/**
 * Metadata for a common flag as exposed to JSON callers of `sentry help --json`.
 */
export type HelpFlagInfo = {
  /** Long flag name including `--` prefix (e.g. `"--json"`). */
  long: string;
  /** Short alias including `-` prefix (e.g. `"-f"`), or undefined if none. */
  short?: string;
  /** One-line description. */
  description: string;
};

/**
 * Result of introspecting the CLI.
 * Yielded as CommandOutput — JSON mode serializes directly, human mode
 * passes through {@link formatHelpHuman}, which renders the branded banner for
 * the full tree.
 */
export type HelpJsonResult =
  | {
      routes: RouteInfo[];
      envVars: HelpEnvVarInfo[];
      flags: HelpFlagInfo[];
    }
  | CommandInfo
  | RouteInfo
  | { error: string; suggestions?: string[] };

/**
 * Build the top-level env-var list for JSON output.
 *
 * Exposes exactly the entries marked `topLevel` in the registry so that
 * consumers (AI agents, docs tooling) can surface them without having to
 * re-parse the CLI's branded help.
 */
function buildTopLevelEnvVars(): HelpEnvVarInfo[] {
  return TOP_LEVEL_ENV_VARS.map((v) => ({
    name: v.name,
    brief: v.briefDescription ?? v.description.split("\n")[0] ?? "",
    description: v.description,
    example: v.example,
    defaultValue: v.defaultValue,
  }));
}

/**
 * Build the common flags list for JSON output.
 *
 * Exposes the same entries shown in the branded help so that consumers
 * (AI agents, docs tooling) can discover them programmatically.
 */
function buildCommonFlags(): HelpFlagInfo[] {
  return COMMON_FLAGS.map((f) => ({
    long: f.long,
    short: f.short,
    description: f.description,
  }));
}

/**
 * Introspect the full command tree.
 * Returns all visible routes with all flags included, plus the top-level
 * environment variables and common flags recognized by the CLI.
 */
export function introspectAllCommands(): {
  routes: RouteInfo[];
  envVars: HelpEnvVarInfo[];
  flags: HelpFlagInfo[];
} {
  const routeMap = routes as unknown as RouteMap;
  return {
    routes: extractAllRoutes(routeMap),
    envVars: buildTopLevelEnvVars(),
    flags: buildCommonFlags(),
  };
}

/**
 * Introspect a specific command or group.
 * Returns the resolved command/group info, or an error object
 * with optional fuzzy suggestions if the path doesn't resolve.
 */
export function introspectCommand(
  commandPath: string[]
): CommandInfo | RouteInfo | { error: string; suggestions?: string[] } {
  const routeMap = routes as unknown as RouteMap;
  const resolved = resolveCommandPath(routeMap, commandPath);
  if (!resolved) {
    return { error: `Command not found: ${commandPath.join(" ")}` };
  }
  if (resolved.kind === "unresolved") {
    const { suggestions } = resolved;
    return {
      error: `Command not found: ${commandPath.join(" ")}`,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  }
  return resolved.info;
}

// ---------------------------------------------------------------------------
// Suggestion Formatting
// ---------------------------------------------------------------------------

/**
 * Join suggestion strings with Oxford-comma grammar.
 *
 * Matches Stricli's "did you mean" style:
 * - 1 item: `"issue"`
 * - 2 items: `"issue or trace"`
 * - 3 items: `"issue, trace, or auth"`
 */
function formatSuggestionList(items: string[]): string {
  if (items.length <= 1) {
    return items.join("");
  }
  if (items.length === 2) {
    return `${items[0]} or ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")}, or ${items.at(-1)}`;
}

// ---------------------------------------------------------------------------
// Human Rendering of Introspection Data
// ---------------------------------------------------------------------------

/**
 * Format a single flag for human display.
 *
 * @param flag - The flag info to format
 * @param aliases - Command alias map for short flag lookup
 * @returns Formatted flag string like "-l, --limit <value> - Max items"
 */
function formatFlagHuman(
  flag: import("./introspect.js").FlagInfo,
  aliases: Record<string, string>
): string {
  const alias = Object.entries(aliases).find(([, v]) => v === flag.name)?.[0];
  let syntax = `--${flag.name}`;
  if (alias) {
    syntax = `-${alias}, ${syntax}`;
  }
  if ((flag.kind === "parsed" || flag.kind === "enum") && !flag.variadic) {
    syntax += " <value>";
  } else if (flag.variadic) {
    syntax += " <value>...";
  }
  const parts = [syntax];
  if (flag.brief) {
    parts.push(flag.brief);
  }
  if (flag.default !== undefined && flag.kind !== "boolean") {
    parts.push(`(default: ${JSON.stringify(flag.default)})`);
  }
  return parts.join(" — ");
}

/**
 * Format a CommandInfo as human-readable text.
 */
function formatCommandHuman(cmd: CommandInfo): string {
  const lines: string[] = [];
  const signature = cmd.positional ? `${cmd.path} ${cmd.positional}` : cmd.path;
  lines.push(signature);
  lines.push("");
  lines.push(`  ${cmd.brief}`);

  const visibleFlags = cmd.flags.filter((f) => !f.hidden);
  if (visibleFlags.length > 0) {
    lines.push("");
    lines.push("  Flags:");
    for (const flag of visibleFlags) {
      lines.push(`    ${formatFlagHuman(flag, cmd.aliases)}`);
    }
  }

  if (cmd.jsonFields && cmd.jsonFields.length > 0) {
    lines.push("");
    lines.push("  JSON fields (use --json --fields to select):");
    for (const field of cmd.jsonFields) {
      const optStr = field.optional ? ", optional" : "";
      const desc = field.description ? ` — ${field.description}` : "";
      lines.push(`    ${field.name} (${field.type}${optStr})${desc}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a RouteInfo group as human-readable text.
 */
function formatGroupHuman(group: RouteInfo): string {
  const lines: string[] = [];
  lines.push(`sentry ${group.name}`);
  lines.push("");
  lines.push(`  ${group.brief}`);
  lines.push("");
  lines.push("  Commands:");

  if (group.commands.length === 0) {
    lines.push("    (no commands)");
    return lines.join("\n");
  }

  // Strip "sentry <group> " prefix to get subcommand name.
  // For nested routes like "sentry dashboard widget add", this yields "widget add".
  const prefix = `sentry ${group.name} `;
  const subName = (cmd: CommandInfo) =>
    cmd.path.startsWith(prefix)
      ? cmd.path.slice(prefix.length)
      : (cmd.path.split(" ").at(-1) ?? "");

  const maxName = Math.max(...group.commands.map((c) => subName(c).length));
  for (const cmd of group.commands) {
    lines.push(`    ${subName(cmd).padEnd(maxName + 2)}${cmd.brief}`);
  }

  return lines.join("\n");
}

/**
 * Human renderer for help introspection data.
 *
 * Formats structured introspection objects as readable CLI output:
 * - Full tree (`routes`): the branded banner + commands + flags + env
 * - Route group: lists subcommands with descriptions
 * - Single command: shows signature, description, and flags
 * - Error: shows the error message
 */
export function formatHelpHuman(data: HelpJsonResult): string {
  // Full command tree → branded human help. Rendered here (not in the help
  // command's func) so `--json`, which never calls this human formatter, never
  // triggers printCustomHelp's sixel probe / terminal I/O.
  if ("routes" in data) {
    return printCustomHelp().trimEnd();
  }

  // Route group
  if ("commands" in data && "name" in data) {
    return formatGroupHuman(data as RouteInfo);
  }

  // Single command
  if ("path" in data) {
    return formatCommandHuman(data as CommandInfo);
  }

  // Error (with optional fuzzy suggestions)
  if ("error" in data) {
    const { suggestions } = data;
    if (suggestions && suggestions.length > 0) {
      return `Error: ${data.error}\n\nDid you mean: ${formatSuggestionList(suggestions)}?`;
    }
    return `Error: ${data.error}`;
  }

  return "";
}
