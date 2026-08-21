/**
 * Small dependency-free primitives for composing sixel raster output.
 *
 * Charts and dashboards use this module to draw into the RGBA buffers consumed
 * by the sixel encoder. The text renderer is deliberately limited to a compact
 * terminal-sized bitmap font: unsupported glyphs remain visible as a fallback
 * box instead of silently disappearing from a dashboard image.
 */

import type { DecodedImage } from "../sixel-image.js";

/** An RGB color tuple with one 0-255 value per channel. */
export type Rgb = [number, number, number];

/** Options for creating a pixel canvas. */
export type CreatePixelCanvasOptions = {
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /** Optional opaque background fill. A missing value leaves pixels transparent. */
  background?: Rgb;
};

/** Options for drawing a filled rectangle. */
export type PixelRectOptions = {
  /** Left edge in pixels. */
  x: number;
  /** Top edge in pixels. */
  y: number;
  /** Rectangle width in pixels. */
  width: number;
  /** Rectangle height in pixels. */
  height: number;
  /** Fill color. */
  color: Rgb;
};

/** Options for drawing one line of terminal-sized bitmap text. */
export type PixelTextOptions = {
  /** Left edge in pixels. */
  x: number;
  /** Top edge in pixels. */
  y: number;
  /** Width of one terminal cell in pixels. */
  cellWidth: number;
  /** Height of one terminal cell in pixels. */
  cellHeight: number;
  /** Maximum number of terminal cells to draw. */
  maxColumns: number;
  /** Glyph color. */
  color: Rgb;
};

/** Create an RGBA pixel canvas, optionally initialized to an opaque color. */
export function createPixelCanvas(
  options: CreatePixelCanvasOptions
): DecodedImage {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const data = new Uint8Array(width * height * 4);
  if (options.background) {
    const [r, g, b] = options.background;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Draw a filled rectangle, clipping it to the canvas bounds. */
export function drawPixelRect(
  image: DecodedImage,
  options: PixelRectOptions
): void {
  const x0 = Math.max(0, Math.floor(options.x));
  const y0 = Math.max(0, Math.floor(options.y));
  const x1 = Math.min(image.width, Math.ceil(options.x + options.width));
  const y1 = Math.min(image.height, Math.ceil(options.y + options.height));
  const [r, g, b] = options.color;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = 255;
    }
  }
}

/** Copy non-transparent source pixels into a destination image. */
export function blitPixelImage(
  destination: DecodedImage,
  source: DecodedImage,
  x: number,
  y: number
): void {
  const destX = Math.floor(x);
  const destY = Math.floor(y);
  const firstSourceX = Math.max(0, -destX);
  const lastSourceX = Math.min(source.width, destination.width - destX);
  const firstSourceY = Math.max(0, -destY);
  const lastSourceY = Math.min(source.height, destination.height - destY);

  for (let sourceY = firstSourceY; sourceY < lastSourceY; sourceY += 1) {
    const targetY = destY + sourceY;
    for (let sourceX = firstSourceX; sourceX < lastSourceX; sourceX += 1) {
      const targetX = destX + sourceX;
      copyOpaquePixel(
        destination,
        source,
        { x: sourceX, y: sourceY },
        {
          x: targetX,
          y: targetY,
        }
      );
    }
  }
}

/** A pixel position in an image buffer. */
type PixelPoint = { x: number; y: number };

/** Copy one source pixel when it is not transparent. */
function copyOpaquePixel(
  destination: DecodedImage,
  source: DecodedImage,
  sourcePoint: PixelPoint,
  targetPoint: PixelPoint
): void {
  const { x: sourceX, y: sourceY } = sourcePoint;
  const { x: targetX, y: targetY } = targetPoint;
  const sourceOffset = (sourceY * source.width + sourceX) * 4;
  if ((source.data[sourceOffset + 3] ?? 0) === 0) {
    return;
  }
  const targetOffset = (targetY * destination.width + targetX) * 4;
  destination.data[targetOffset] = source.data[sourceOffset] ?? 0;
  destination.data[targetOffset + 1] = source.data[sourceOffset + 1] ?? 0;
  destination.data[targetOffset + 2] = source.data[sourceOffset + 2] ?? 0;
  destination.data[targetOffset + 3] = source.data[sourceOffset + 3] ?? 255;
}

/** 5x7 glyphs for dashboard labels and table content. */
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
  ",": ["00000", "00000", "00000", "00000", "00110", "00110", "00100"],
  ":": ["00000", "00110", "00110", "00000", "00110", "00110", "00000"],
  ";": ["00000", "00110", "00110", "00000", "00110", "00110", "00100"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  _: ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
  "\\": ["10000", "01000", "00100", "00010", "00001", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "[": ["01110", "01000", "01000", "01000", "01000", "01000", "01110"],
  "]": ["01110", "00010", "00010", "00010", "00010", "00010", "01110"],
  "=": ["00000", "11111", "00000", "11111", "00000", "00000", "00000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "#": ["01010", "11111", "01010", "01010", "11111", "01010", "00000"],
  "%": ["11001", "11010", "00100", "01000", "10110", "00110", "00000"],
  "@": ["01110", "10001", "10111", "10101", "10111", "10000", "01111"],
  "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
  "|": ["00100", "00100", "00100", "00100", "00100", "00100", "00100"],
  "<": ["00010", "00100", "01000", "10000", "01000", "00100", "00010"],
  ">": ["01000", "00100", "00010", "00001", "00010", "00100", "01000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "'": ["00100", "00100", "00010", "00000", "00000", "00000", "00000"],
  '"': ["01010", "01010", "00100", "00000", "00000", "00000", "00000"],
  "█": ["11111", "11111", "11111", "11111", "11111", "11111", "11111"],
  "■": ["01110", "11111", "11111", "11111", "11111", "11111", "01110"],
};

/** Visible fallback for a Unicode glyph outside the compact bitmap font. */
const UNKNOWN_GLYPH = [
  "11111",
  "10001",
  "10101",
  "10101",
  "10101",
  "10001",
  "11111",
];

/** Draw a single line of compact bitmap text, clipped to its terminal cells. */
export function drawPixelText(
  image: DecodedImage,
  text: string,
  options: PixelTextOptions
): void {
  const scale = Math.max(
    1,
    Math.min(
      Math.floor((options.cellWidth - 2) / 5),
      Math.floor((options.cellHeight - 2) / 7)
    )
  );

  let column = 0;
  for (const rawChar of text) {
    if (column >= options.maxColumns) {
      break;
    }
    const glyph = FONT[rawChar.toUpperCase()] ?? UNKNOWN_GLYPH;
    const glyphWidth = 5 * scale;
    const glyphHeight = 7 * scale;
    const glyphX =
      options.x +
      column * options.cellWidth +
      Math.max(0, Math.floor((options.cellWidth - glyphWidth) / 2));
    const glyphY =
      options.y +
      Math.max(0, Math.floor((options.cellHeight - glyphHeight) / 2));

    for (let row = 0; row < glyph.length; row += 1) {
      const pattern = glyph[row] ?? "00000";
      for (let pixel = 0; pixel < pattern.length; pixel += 1) {
        if (pattern[pixel] === "1") {
          drawPixelRect(image, {
            x: glyphX + pixel * scale,
            y: glyphY + row * scale,
            width: scale,
            height: scale,
            color: options.color,
          });
        }
      }
    }
    column += 1;
  }
}
