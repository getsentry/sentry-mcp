import { describe, it, expect } from "vitest";
import { blobToBase64, detectImageMimeType } from "./blob-utils.js";

describe("blob-utils", () => {
  describe("blobToBase64", () => {
    it("converts blob to base64 string", async () => {
      const blob = new Blob([new Uint8Array([1, 2, 3])]);
      const result = await blobToBase64(blob);
      expect(result).toBe(Buffer.from([1, 2, 3]).toString("base64"));
    });
  });

  describe("detectImageMimeType", () => {
    it("detects PNG", async () => {
      const png = new Blob([
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ]);
      expect(await detectImageMimeType(png)).toBe("image/png");
    });

    it("detects JPEG", async () => {
      const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]);
      expect(await detectImageMimeType(jpeg)).toBe("image/jpeg");
    });

    it("detects GIF", async () => {
      const gif = new Blob([
        new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
      ]);
      expect(await detectImageMimeType(gif)).toBe("image/gif");
    });

    it("detects WebP", async () => {
      const webp = new Blob([
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
          0x50,
        ]),
      ]);
      expect(await detectImageMimeType(webp)).toBe("image/webp");
    });

    it("returns null for unknown format", async () => {
      const unknown = new Blob([new Uint8Array([0x00, 0x01, 0x02, 0x03])]);
      expect(await detectImageMimeType(unknown)).toBeNull();
    });

    it("returns null for empty blob", async () => {
      const empty = new Blob([]);
      expect(await detectImageMimeType(empty)).toBeNull();
    });
  });
});
