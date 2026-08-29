import { describe, expect, test, vi } from "vitest";
import { getCozetteGlyph } from "../../../src/lib/formatters/cozette-font.js";
import {
  createPixelCanvas,
  drawPixelText,
} from "../../../src/lib/formatters/pixel-canvas.js";

function opaquePixelCount(image: { data: Uint8Array }): number {
  let count = 0;
  for (let index = 3; index < image.data.length; index += 4) {
    if (image.data[index] === 255) {
      count += 1;
    }
  }
  return count;
}

describe("drawPixelText", () => {
  test("uses Cozette's native 6x13 raster at terminal cell size", () => {
    const image = createPixelCanvas({ width: 6, height: 13 });

    drawPixelText(image, "A", {
      x: 0,
      y: 0,
      cellWidth: 6,
      cellHeight: 13,
      maxColumns: 1,
      color: [255, 255, 255],
    });

    expect(opaquePixelCount(image)).toBe(20);
    expect(image.data[(2 * image.width + 2) * 4 + 3]).toBe(255);
    expect(image.data[(0 * image.width + 1) * 4 + 3]).toBe(0);
  });

  test("packs Cozette rows with bit five as the leftmost pixel", () => {
    expect(getCozetteGlyph("A")[2]).toBe(0b00_1110);
  });

  test("includes the half-block and rule glyphs used by dashboard content", () => {
    expect([...getCozetteGlyph("▀")]).toEqual([
      63, 63, 63, 63, 63, 63, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect([...getCozetteGlyph("▄")]).toEqual([
      0, 0, 0, 0, 0, 0, 63, 63, 63, 63, 63, 63, 63,
    ]);
    expect([...getCozetteGlyph("─")]).toEqual([
      0, 0, 0, 0, 0, 0, 63, 0, 0, 0, 0, 0, 0,
    ]);
  });

  test("uses a question mark for unsupported text glyphs", () => {
    expect([...getCozetteGlyph("\u6f22")]).toEqual([...getCozetteGlyph("?")]);
  });

  test("includes the dashboard axis, sparkline, and ellipsis glyphs", () => {
    const questionMark = [...getCozetteGlyph("?")];
    for (const character of [
      "│",
      "└",
      "┤",
      "┬",
      "…",
      "▁",
      "▂",
      "▃",
      "▄",
      "▅",
      "▆",
      "▇",
      "░",
      "▓",
    ]) {
      expect([...getCozetteGlyph(character)]).not.toEqual(questionMark);
    }
  });

  test("renders accented labels and typographic punctuation legibly", () => {
    const rendered = renderText("Café — 50…");
    const expected = renderText("Cafe - 50…");

    expect(rendered.data).toEqual(expected.data);
  });

  test("does not normalize text outside its visible width", () => {
    const normalize = vi.spyOn(String.prototype, "normalize");
    const image = createPixelCanvas({ width: 6, height: 13 });

    try {
      drawPixelText(image, `A${"é".repeat(100)}`, {
        x: 0,
        y: 0,
        cellWidth: 6,
        cellHeight: 13,
        maxColumns: 1,
        color: [255, 255, 255],
      });

      expect(normalize).not.toHaveBeenCalled();
    } finally {
      normalize.mockRestore();
    }
  });

  test("fills non-integer terminal cells with proportional bitmap scaling", () => {
    const image = createPixelCanvas({ width: 9, height: 18 });

    drawPixelText(image, "A", {
      x: 0,
      y: 0,
      cellWidth: 9,
      cellHeight: 18,
      maxColumns: 1,
      color: [255, 255, 255],
    });

    expect(opaquePixelCount(image)).toBe(48);
    expect(image.data[(2 * image.width + 3) * 4 + 3]).toBe(255);
  });

  test("uses proportional scaling for larger cells", () => {
    const image = createPixelCanvas({ width: 12, height: 26 });

    drawPixelText(image, "A", {
      x: 0,
      y: 0,
      cellWidth: 12,
      cellHeight: 26,
      maxColumns: 1,
      color: [255, 255, 255],
    });

    expect(opaquePixelCount(image)).toBe(20 * 4);
  });

  test("never draws outside an undersized terminal cell", () => {
    const image = createPixelCanvas({ width: 16, height: 16 });

    drawPixelText(image, "AA", {
      x: 4,
      y: 4,
      cellWidth: 4,
      cellHeight: 8,
      maxColumns: 2,
      color: [255, 255, 255],
    });

    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const opaque = image.data[(y * image.width + x) * 4 + 3] === 255;
        if (opaque) {
          expect(x).toBeGreaterThanOrEqual(4);
          expect(x).toBeLessThan(12);
          expect(y).toBeGreaterThanOrEqual(4);
          expect(y).toBeLessThan(12);
        }
      }
    }
  });
});

function renderText(text: string) {
  const image = createPixelCanvas({ width: 120, height: 13 });
  drawPixelText(image, text, {
    x: 0,
    y: 0,
    cellWidth: 6,
    cellHeight: 13,
    maxColumns: 20,
    color: [255, 255, 255],
  });
  return image;
}
