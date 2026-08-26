/**
 * Sixel Banner Support
 *
 * Detects whether the current terminal can render sixel graphics and, if so,
 * returns the baked banner (see {@link BANNER_SIXEL}) sized to fit the terminal.
 * Everything degrades gracefully to the block-art banner in `banner.ts`.
 *
 * Detection uses a synchronous, best-effort terminal round-trip (unix only):
 *   - Primary Device Attributes (`ESC [ c`) — attribute `4` means sixel.
 *   - Text-area cell size (`ESC [ 16 t` → `ESC [ 6 ; H ; W t`) — used to check
 *     the fixed-pixel image actually fits the current column width.
 *   - Kitty graphics query (`ESC _ G ... a=q ... ESC \`) — an `OK` reply means
 *     the terminal speaks the newer kitty protocol, preferred over sixel.
 * The probe is gated behind an interactive TTY, honors plain-output/opt-out
 * signals, has a short timeout, restores terminal state, and never throws.
 * The result is cached for the process.
 */

import { execSync } from "node:child_process";
import { closeSync, openSync, readSync, writeSync } from "node:fs";
import { BANNER_SIXEL } from "../generated/banner-sixel.js";
import { getGraphicsPreference } from "./db/defaults.js";
import { getEnv } from "./env.js";
import { isPlainOutput, isTruthyEnv } from "./formatters/plain-detect.js";

/** Terminal graphics capabilities discovered by the probe. */
export type SixelCaps = {
  /** True when the terminal advertised sixel support (DA1 attribute 4). */
  supported: boolean;
  /**
   * True when the terminal advertised kitty graphics support (it answered the
   * graphics query with `OK`). Preferred over sixel when present.
   */
  kitty?: boolean;
  /** Character-cell width in pixels (from `CSI 16 t`), when reported. */
  cellWidth?: number;
  /** Character-cell height in pixels (from `CSI 16 t`), when reported. */
  cellHeight?: number;
};

/** Shared "no graphics" result. */
const UNSUPPORTED: SixelCaps = { supported: false };

/** Primary DA reply: `ESC [ ? <p;p;...> c` — attribute list; `4` == sixel. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: parsing terminal escapes
const DA1_RE = /\x1b\[\?([0-9;]*)c/;

/** Cell-size report: `ESC [ 6 ; <height> ; <width> t`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: parsing terminal escapes
const CELL_SIZE_RE = /\x1b\[6;(\d+);(\d+)t/;

/** Kitty graphics query reply: `ESC _ G i=<id>;OK ESC \`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: parsing terminal escapes
const KITTY_RE = /\x1b_G[^\x1b]*;OK/;

/**
 * Kitty graphics query. Uploads a 1×1 RGB pixel (`f=24`) directly (`t=d`) with
 * `a=q` so the terminal only answers with support status and draws nothing. A
 * kitty-capable terminal replies `ESC _ G i=31;OK ESC \`; others ignore it.
 */
const KITTY_QUERY = "\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\";

let cached: SixelCaps | undefined;

/** Clear the cached probe result. Test-only. */
export function __resetSixelCache(): void {
  cached = undefined;
}

/**
 * Parse a terminal's reply to the DA1 + cell-size + kitty queries.
 *
 * Pure and side-effect free so it can be unit-tested without a terminal.
 * Returns {@link UNSUPPORTED} unless the DA1 attribute list contains `4`
 * (sixel) or the terminal answered the kitty graphics query with `OK`.
 */
export function parseSixelCaps(reply: string): SixelCaps {
  const da = reply.match(DA1_RE);
  const attrs = da?.[1]?.split(";") ?? [];
  const kitty = KITTY_RE.test(reply);
  if (!(attrs.includes("4") || kitty)) {
    return UNSUPPORTED;
  }
  const caps: SixelCaps = { supported: attrs.includes("4") };
  if (kitty) {
    caps.kitty = true;
  }
  const size = reply.match(CELL_SIZE_RE);
  if (size) {
    caps.cellHeight = Number(size[1]);
    caps.cellWidth = Number(size[2]);
  }
  return caps;
}

/**
 * Whether the fixed-pixel banner of `bannerWidth` px fits within `columns`
 * given the reported cell width. Requires a known cell width — if the terminal
 * didn't report one we can't guarantee the image won't overflow, so we decline.
 */
export function sixelFits(
  caps: SixelCaps,
  columns: number,
  bannerWidth: number
): boolean {
  if (!(caps.supported && caps.cellWidth && caps.cellWidth > 0)) {
    return false;
  }
  return bannerWidth <= columns * caps.cellWidth;
}

/**
 * True when any signal says we must not probe/emit sixel. Exported for tests.
 * @internal
 */
export function optedOut(): boolean {
  // Use the isolation-aware env (matches isPlainOutput) so library/test runs
  // that call setEnv() see consistent TERM / SENTRY_NO_GRAPHICS values.
  const env = getEnv();
  return (
    !(process.stdout.isTTY && process.stdin.isTTY) ||
    process.platform === "win32" || // MVP: probe is unix-only
    isPlainOutput() ||
    !env.TERM ||
    env.TERM === "dumb" ||
    isTruthyEnv(env.SENTRY_NO_GRAPHICS ?? "") ||
    isTruthyEnv(env.SENTRY_NO_SIXEL ?? "")
  );
}

/**
 * Read the terminal's query replies from a blocking tty fd. With the tty in
 * `min 0 time N` mode each read blocks up to N deciseconds and returns 0 on
 * timeout.
 *
 * The queries are ordered so the Primary DA reply (which every terminal answers,
 * as `ESC [ ? … c`) arrives LAST — after the optional cell-size reply. So once a
 * complete DA reply is seen the whole reply has been drained, guaranteeing
 * nothing trails into the shell prompt even if the cell-size report lagged.
 *
 * Matching the full DA pattern (not merely any `c`) avoids stopping early on a
 * stray `c` — e.g. a keypress on `/dev/tty` during the probe. Exported for tests.
 * @internal
 */
export function readReply(fd: number): string {
  const buf = Buffer.alloc(256);
  let data = "";
  for (let i = 0; i < 16; i++) {
    let n = 0;
    try {
      n = readSync(fd, buf, 0, buf.length, null);
    } catch {
      break;
    }
    if (n <= 0) {
      break;
    }
    data += buf.toString("latin1", 0, n);
    // Stop only once the complete Primary DA (sentinel) reply has arrived.
    if (DA1_RE.test(data)) {
      break;
    }
  }
  return data;
}

/**
 * Probe the terminal for sixel support. Synchronous, best-effort, unix-only.
 * Puts the tty in a timed raw read mode, emits the queries, parses the reply,
 * and always restores the prior tty state.
 *
 * Reads/writes a dedicated blocking `/dev/tty` fd rather than stdin (fd 0):
 * Node keeps stdin non-blocking, so a `readSync(0)` would return EAGAIN before
 * the terminal replies — leaving the reply to leak onto the shell prompt.
 */
function probe(): SixelCaps {
  if (optedOut()) {
    return UNSUPPORTED;
  }
  let savedStty: string | undefined;
  let fd: number | undefined;
  try {
    fd = openSync("/dev/tty", "r+");
    savedStty = execSync("stty -g < /dev/tty", { encoding: "utf8" }).trim();
    // min 0 time 3 => each read blocks up to ~300ms for (more) reply bytes.
    execSync("stty -echo -icanon min 0 time 3 < /dev/tty");
    // Cell-size and kitty queries first, Primary DA last: DA's `c` is the
    // drain sentinel every terminal answers, so the optional cell-size and
    // kitty replies (which capable terminals send ahead of it) are all drained.
    writeSync(fd, `\x1b[16t${KITTY_QUERY}\x1b[c`);
    return parseSixelCaps(readReply(fd));
  } catch {
    return UNSUPPORTED;
  } finally {
    if (savedStty) {
      try {
        execSync(`stty ${savedStty} < /dev/tty`);
      } catch {
        // Best-effort restore; nothing actionable if it fails.
      }
    }
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Best-effort close.
      }
    }
  }
}

/** Cached terminal sixel capabilities (probes once per process). */
export function detectSixelCaps(): SixelCaps {
  if (!cached) {
    cached = probe();
  }
  return cached;
}

/**
 * True when the current terminal can display sixel graphics right now: it's an
 * interactive TTY, not opted out (plain-output / SENTRY_NO_GRAPHICS /
 * SENTRY_NO_SIXEL / non-unix), the persistent graphics=off default is not set,
 * and it advertised sixel support in the DA1 probe.
 *
 * Used by callers that render arbitrary images (not just the baked banner),
 * e.g. `sentry api` displaying image attachments inline.
 */
export function canRenderSixel(): boolean {
  if (optedOut()) {
    return false;
  }
  if (getGraphicsPreference() === false) {
    return false;
  }
  return detectSixelCaps().supported;
}

/**
 * True when the current terminal can display kitty graphics right now: it's an
 * interactive TTY, not opted out (plain-output / SENTRY_NO_GRAPHICS /
 * SENTRY_NO_SIXEL / non-unix), the persistent graphics=off default is not set,
 * and it answered the kitty graphics query with `OK`. Newer terminals prefer
 * this protocol, so callers rendering arbitrary images (e.g. `sentry api`
 * attachments) check this before falling back to {@link canRenderSixel}.
 */
export function canRenderKitty(): boolean {
  if (optedOut()) {
    return false;
  }
  if (getGraphicsPreference() === false) {
    return false;
  }
  return detectSixelCaps().kitty === true;
}

/**
 * The usable image width in device pixels for the current terminal — the
 * number of columns times the reported character-cell width. Returns
 * `undefined` when the terminal didn't report a cell width (in which case a
 * caller can't know the pixel budget and should fall back to a safe default).
 *
 * Callers rendering arbitrary images (e.g. `sentry api` attachments) use this
 * to downscale so a wide image doesn't overflow the terminal and garble the
 * session, mirroring the fit check {@link sixelFits} does for the banner.
 */
export function terminalPixelWidth(
  columns: number = process.stdout.columns ?? 80
): number | undefined {
  const caps = detectSixelCaps();
  if (
    !((caps.supported || caps.kitty) && caps.cellWidth && caps.cellWidth > 0)
  ) {
    return;
  }
  return columns * caps.cellWidth;
}

/**
 * The usable image height in device pixels for a number of terminal rows.
 *
 * Returns `undefined` when the terminal did not report cell height. Callers
 * rendering positioned sixel layouts must require this measurement rather than
 * guessing, because a guessed row height corrupts the dashboard grid.
 */
export function terminalPixelHeight(
  rows: number = process.stdout.rows ?? 24
): number | undefined {
  const caps = detectSixelCaps();
  if (
    !((caps.supported || caps.kitty) && caps.cellHeight && caps.cellHeight > 0)
  ) {
    return;
  }
  return rows * caps.cellHeight;
}

/**
 * The baked sixel banner escape string when the terminal supports sixel and the
 * image fits `columns`; otherwise `undefined` so the caller falls back to the
 * block-art banner.
 */
export function sixelBanner(
  columns: number = process.stdout.columns ?? 80
): string | undefined {
  // Re-evaluate the cheap, I/O-free gates on every call. detectSixelCaps caches
  // the probe result, so this ensures a later opt-out (NO_COLOR,
  // SENTRY_PLAIN_OUTPUT, SENTRY_NO_SIXEL, or a non-TTY stream) still suppresses
  // the image even if capabilities were cached as supported earlier.
  if (optedOut()) {
    return;
  }
  if (getGraphicsPreference() === false) {
    return;
  }
  const caps = detectSixelCaps();
  return sixelFits(caps, columns, BANNER_SIXEL.width)
    ? BANNER_SIXEL.data
    : undefined;
}
