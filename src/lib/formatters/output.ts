/**
 * Shared output utilities
 *
 * Handles the common pattern of JSON vs human-readable output
 * that appears in most CLI commands.
 *
 * Declare formatting in {@link OutputConfig} on `buildCommand`, then
 * yield data from the generator:
 * ```ts
 * buildCommand({
 *   output: { human: formatUser },
 *   async *func() { yield new CommandOutput(data); },
 * })
 * ```
 * The wrapper reads `json`/`fields` from flags and applies formatting
 * automatically. Generators return `{ hint }` for footer text.
 *
 * The same data object is serialized to JSON and passed to the human
 * formatter — there is no divergent-data path.
 */

import type { ZodType } from "zod";
import type { Writer } from "../../types/index.js";
import { plainSafeMuted } from "./human.js";
import { filterFields, formatJson } from "./json.js";

// ---------------------------------------------------------------------------
// Zero-copy object capture (library mode)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Output config (declared on buildCommand)
// ---------------------------------------------------------------------------

/**
 * Stateful human renderer created once per command invocation.
 *
 * The wrapper calls `render()` once per yielded value and `finalize()`
 * once after the generator completes. This enables streaming commands
 * to maintain per-invocation rendering state (e.g., a table that needs
 * a header on first call and a footer on last).
 *
 * For stateless commands, `finalize` can be omitted — the wrapper falls
 * back to `writeFooter(hint)`.
 *
 * @typeParam T - The data type yielded by the command
 */
export type HumanRenderer<T> = {
  /** Render a single yielded data chunk as human-readable text. */
  render: (data: T) => string;
  /**
   * Called once after the generator completes. Returns the final output
   * string (e.g., a streaming table's bottom border + formatted hint).
   *
   * When defined, replaces the default `writeFooter(hint)` behavior —
   * the wrapper writes the returned string directly.
   *
   * When absent, the wrapper falls back to `writeFooter(hint)`.
   */
  finalize?: (hint?: string) => string;
};

/**
 * Resolve the `human` field of an {@link OutputConfig} into a
 * {@link HumanRenderer}. Supports two forms:
 *
 * 1. **Plain function** — `(data: T) => string` — auto-wrapped into a
 *    stateless renderer (no `finalize`).
 * 2. **Factory** — `() => HumanRenderer<T>` — called once per invocation
 *    to produce a renderer with optional `finalize()`.
 *
 * Disambiguation: a function with `.length === 0` is treated as a factory.
 */
export function resolveRenderer<T>(human: HumanOutput<T>): HumanRenderer<T> {
  // Factory: zero-arg function that returns a renderer
  if (human.length === 0) {
    return (human as () => HumanRenderer<T>)();
  }
  // Plain formatter: wrap in a stateless renderer
  return { render: human as (data: T) => string };
}

/**
 * Human rendering for an {@link OutputConfig}.
 *
 * Two forms:
 * - **Plain function** `(data: T) => string` — stateless, auto-wrapped.
 * - **Factory** `() => HumanRenderer<T>` — called per invocation for
 *   stateful renderers (e.g., streaming tables with `finalize()`).
 */
export type HumanOutput<T> = ((data: T) => string) | (() => HumanRenderer<T>);

/**
 * Output configuration declared on `buildCommand` for automatic rendering.
 *
 * When present, `--json` and `--fields` flags are injected and the wrapper
 * auto-renders yielded {@link CommandOutput} values.
 *
 * @typeParam T - Type of data the command yields (used by `human` formatter
 *   and serialized as-is to JSON)
 */
export type OutputConfig<T> = {
  /**
   * Human-readable renderer.
   *
   * Pass a plain `(data: T) => string` for stateless formatting, or a
   * zero-arg factory `() => HumanRenderer<T>` for stateful rendering
   * with `finalize()` support.
   */
  human: HumanOutput<T>;
  /**
   * Top-level keys to strip from JSON output.
   *
   * Use this for fields that exist only for the human formatter
   * (e.g. pre-formatted terminal strings) and should not appear
   * in the JSON contract.
   *
   * Ignored when {@link jsonTransform} is set — the transform is
   * responsible for shaping the final JSON output.
   */
  jsonExclude?: ReadonlyArray<keyof T & string>;
  /**
   * Custom JSON serialization transform.
   *
   * When set, replaces the default JSON output path entirely.
   * The function receives the raw command data and the parsed `--fields`
   * list, and returns the final object to serialize.
   *
   * This is useful for list commands that wrap items in a
   * `{ data, hasMore, nextCursor }` envelope and need per-element
   * field filtering rather than top-level filtering.
   *
   * When `jsonTransform` is set, `jsonExclude` is ignored.
   */
  jsonTransform?: (data: T, fields?: string[]) => unknown;
  /**
   * Zod schema describing the shape of JSON output (after transform/exclude).
   *
   * For list commands with {@link jsonTransform}, this should describe the
   * **item** type (what `--fields` operates on), not the envelope.
   *
   * Used for:
   * - `--help` output: appends available JSON fields to the command description
   * - `sentry help <cmd>`: structured field documentation
   * - `generate-skill.ts`: SKILL.md field tables for AI agents
   */
  schema?: ZodType;
};

/**
 * Yield type for commands with {@link OutputConfig}.
 *
 * Commands wrap each yielded value in this class so the `buildCommand`
 * wrapper can unambiguously detect data vs void/raw yields via `instanceof`.
 *
 * Hints are NOT carried on yielded values — they belong on the generator's
 * return value ({@link CommandReturn}) so the framework renders them once
 * after the generator completes.
 *
 * @typeParam T - The data type (matches the `OutputConfig<T>` type parameter)
 */
export class CommandOutput<T> {
  /** The data to render (serialized as-is to JSON, passed to `human` formatter) */
  readonly data: T;
  constructor(data: T) {
    this.data = data;
  }
}

/**
 * Yield token that tells the `buildCommand` wrapper to clear the terminal.
 *
 * On interactive terminals (TTY, non-plain), writes ANSI escape codes
 * to move the cursor home and clear the screen. On piped/plain output
 * or in JSON mode, the token is silently ignored.
 *
 * Use before re-yielding `CommandOutput` in refresh/polling loops
 * so the new output replaces the old in-place rather than appending.
 */
export class ClearScreen {
  /** Brand field for instanceof checks — never read, just exists. */
  readonly _brand = "ClearScreen" as const;
}

/**
 * Return type for command generators.
 *
 * Carries metadata that applies to the entire command invocation — not to
 * individual yielded chunks. The `buildCommand` wrapper captures this from
 * the generator's return value (the `done: true` result of `.next()`).
 *
 * `hint` is shown in human mode and suppressed in JSON mode.
 */
export type CommandReturn = {
  /**
   * Hint line appended after all output (suppressed in JSON mode).
   *
   * When the renderer has a `finalize()` method, the hint is passed
   * to it — the renderer decides how to render it alongside any
   * cleanup output (e.g., table footer). Otherwise the wrapper writes
   * it via `writeFooter()`.
   */
  hint?: string;
};

/**
 * Rendering context passed to {@link renderCommandOutput}.
 * Contains the wrapper-injected flag values needed for output mode selection.
 */
type RenderContext = {
  /** Whether `--json` was passed */
  json: boolean;
  /** Pre-parsed `--fields` value */
  fields?: string[];
  /** ANSI prefix to prepend to the output (e.g., clear-screen escape) */
  clearPrefix?: string;
};

/**
 * Apply `jsonExclude` keys to data, stripping excluded fields from
 * objects or from each element of an array. Returns the data unchanged
 * when no exclusions are configured.
 */
function applyJsonExclude(
  data: unknown,
  excludeKeys: readonly string[] | undefined
): unknown {
  if (!excludeKeys || excludeKeys.length === 0) {
    return data;
  }
  if (typeof data !== "object" || data === null) {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item: unknown) => {
      if (typeof item !== "object" || item === null) {
        return item;
      }
      const copy = { ...item } as Record<string, unknown>;
      for (const key of excludeKeys) {
        delete copy[key];
      }
      return copy;
    });
  }
  const copy = { ...data } as Record<string, unknown>;
  for (const key of excludeKeys) {
    delete copy[key];
  }
  return copy;
}

/**
 * Write a final JSON object to stdout.
 *
 * When the writer supports zero-copy capture (library mode), the object
 * is handed off directly without serialization. Otherwise it is
 * JSON-stringified and written as a single line.
 */
function emitJsonObject(stdout: Writer, obj: unknown): void {
  if (stdout.captureObject) {
    stdout.captureObject(obj);
    return;
  }
  stdout.write(`${formatJson(obj)}\n`);
}

/**
 * Render a single yielded `CommandOutput<T>` chunk.
 *
 * Called by the `buildCommand` wrapper per yielded value. In JSON mode
 * the data is serialized (with optional field filtering / transform);
 * in human mode the resolved renderer's `render()` is called.
 *
 * Hints are NOT rendered here — the wrapper calls `finalize()` or
 * `writeFooter()` once after the generator completes.
 *
 * @param stdout - Writer to output to
 * @param data - The data yielded by the command
 * @param config - The output config declared on buildCommand
 * @param renderer - Per-invocation renderer (from `config.human()`)
 * @param ctx - Rendering context with flag values
 */
// biome-ignore lint/nursery/useMaxParams: Framework function — config/renderer/ctx are all required for JSON vs human split.
export function renderCommandOutput(
  stdout: Writer,
  data: unknown,
  // biome-ignore lint/suspicious/noExplicitAny: Variance erasure — config/renderer are paired at build time, but the framework iterates over unknown yields.
  config: OutputConfig<any>,
  // biome-ignore lint/suspicious/noExplicitAny: Renderer type mirrors erased OutputConfig<T>
  renderer: HumanRenderer<any>,
  ctx: RenderContext
): void {
  // Binary bodies (Uint8Array) must bypass text formatters entirely — no
  // JSON pretty-print, no trailing newline, no string coercion. This is the
  // path `sentry api` uses for attachment downloads and other non-textual
  // Content-Types so redirected stdout stays byte-for-byte faithful.
  if (data instanceof Uint8Array) {
    stdout.write(data);
    return;
  }

  if (ctx.json) {
    if (config.jsonTransform) {
      const transformed = config.jsonTransform(data, ctx.fields);
      if (transformed === undefined) {
        return;
      }
      emitJsonObject(stdout, transformed);
      return;
    }

    const excluded = applyJsonExclude(data, config.jsonExclude);
    const final =
      ctx.fields && ctx.fields.length > 0
        ? filterFields(excluded, ctx.fields)
        : excluded;
    emitJsonObject(stdout, final);
    return;
  }

  const text = renderer.render(data);
  if (text) {
    const prefix = ctx.clearPrefix ?? "";
    stdout.write(`${prefix}${text}\n`);
  }
}

// ---------------------------------------------------------------------------
// Schema introspection
// ---------------------------------------------------------------------------

/**
 * Field metadata extracted from a Zod schema for documentation.
 *
 * Populated by {@link extractSchemaFields} and consumed by:
 * - `introspect.ts` → `CommandInfo.jsonFields`
 * - `help.ts` → human help output
 * - `generate-skill.ts` → SKILL.md field tables
 */
export type SchemaFieldInfo = {
  /** Field name (top-level key in the JSON object) */
  name: string;
  /** Human-readable type string (e.g. "string", "number", "object", "string | null") */
  type: string;
  /** Description from `z.describe()` */
  description?: string;
  /** Whether the field is optional in the schema */
  optional: boolean;
};

/** Leaf-type name mapping for {@link zodTypeToString} */
const ZOD_TYPE_MAP: Record<string, string> = {
  ZodString: "string",
  ZodNumber: "number",
  ZodBoolean: "boolean",
  ZodObject: "object",
  ZodArray: "array",
  ZodRecord: "object",
  ZodNull: "null",
  ZodUnknown: "unknown",
  ZodAny: "any",
  ZodEnum: "string",
  ZodLiteral: "string",
};

/**
 * Resolve a `ZodUnion` into a deduplicated `" | "`-joined type string.
 *
 * Used by auto-generated `@sentry/api/zod` schemas that represent nullable
 * fields as `z.union([z.string(), z.null()])` instead of `z.string().nullable()`.
 */
function resolveZodUnion(options: ZodType[]): {
  type: string;
  optional: boolean;
} {
  let optional = false;
  const parts: string[] = [];
  for (const opt of options) {
    const resolved = zodTypeToString(opt);
    if (resolved.optional) {
      optional = true;
    }
    if (!parts.includes(resolved.type)) {
      parts.push(resolved.type);
    }
  }
  return { type: parts.join(" | "), optional };
}

/**
 * Map a Zod type's internal `typeName` to a human-readable string.
 *
 * Unwraps wrapper types (Optional, Nullable, Default) and builds a
 * composite type string (e.g. "string | null" for ZodNullable<ZodString>).
 * Delegates ZodUnion handling to {@link resolveZodUnion}.
 */
function zodTypeToString(schema: ZodType): { type: string; optional: boolean } {
  const def = (schema as { _def?: { typeName?: string; innerType?: ZodType } })
    ._def;
  if (!def?.typeName) {
    return { type: "unknown", optional: false };
  }

  // Unwrap wrapper types recursively
  if (def.typeName === "ZodOptional" && def.innerType) {
    const inner = zodTypeToString(def.innerType);
    return { type: inner.type, optional: true };
  }
  if (def.typeName === "ZodNullable" && def.innerType) {
    const inner = zodTypeToString(def.innerType);
    const nullableType = inner.type.includes(" | null")
      ? inner.type
      : `${inner.type} | null`;
    return { type: nullableType, optional: inner.optional };
  }
  if (def.typeName === "ZodDefault" && def.innerType) {
    return zodTypeToString(def.innerType);
  }
  if (def.typeName === "ZodUnion") {
    const options = (def as { options?: ZodType[] }).options;
    if (options?.length) {
      return resolveZodUnion(options);
    }
  }

  return { type: ZOD_TYPE_MAP[def.typeName] ?? "unknown", optional: false };
}

/**
 * Extract field metadata from a Zod object schema.
 *
 * Returns an array of {@link SchemaFieldInfo} describing each top-level
 * field's name, type, description, and optionality. Returns an empty
 * array for non-object schemas.
 *
 * @param schema - A Zod schema (typically `z.object({...})`)
 */
export function extractSchemaFields(schema: ZodType): SchemaFieldInfo[] {
  const def = (
    schema as {
      _def?: { typeName?: string };
      shape?: Record<string, ZodType>;
    }
  )._def;

  if (def?.typeName !== "ZodObject") {
    return [];
  }

  const shape = (schema as { shape?: Record<string, ZodType> }).shape;
  if (!shape) {
    return [];
  }

  return Object.entries(shape).map(([name, fieldSchema]) => {
    const { type, optional } = zodTypeToString(fieldSchema);
    const fieldDef = (fieldSchema as { description?: string }).description;
    return {
      name,
      type,
      description: fieldDef,
      optional,
    };
  });
}

/**
 * Format schema fields as a help text block for `--help` output.
 *
 * Produces a compact field list like:
 * ```
 * JSON fields (use --json --fields to select):
 *   id (string) — Numeric issue ID
 *   count (string, optional) — Total event count
 * ```
 */
export function formatSchemaForHelp(fields: SchemaFieldInfo[]): string {
  if (fields.length === 0) {
    return "";
  }
  const lines = ["JSON fields (use --json --fields to select):"];
  for (const field of fields) {
    const optStr = field.optional ? ", optional" : "";
    const desc = field.description ? ` — ${field.description}` : "";
    lines.push(`  ${field.name} (${field.type}${optStr})${desc}`);
  }
  return lines.join("\n");
}

/** Format footer text (muted in TTY, plain when piped, with surrounding newlines). */
export function formatFooter(text: string): string {
  return `\n${plainSafeMuted(text)}\n`;
}

/**
 * Write a formatted footer hint to stdout.
 * Adds empty line separator and applies muted styling.
 */
export function writeFooter(stdout: Writer, text: string): void {
  stdout.write(formatFooter(text));
}
