import { describe, it, expect } from "vitest";
import { decode as decodePng, encode as encodePng } from "fast-png";
import jpeg from "jpeg-js";
import {
  blobToBase64,
  createImagePreview,
  detectImageMimeType,
} from "./blob-utils.js";

describe("blob-utils", () => {
  describe("blobToBase64", () => {
    it("converts blob to base64 string", async () => {
      const blob = new Blob([new Uint8Array([1, 2, 3])]);
      const result = await blobToBase64(blob);
      expect(result).toBe(Buffer.from([1, 2, 3]).toString("base64"));
    });
  });

  describe("createImagePreview", () => {
    it("resizes PNG previews within the max dimension while preserving aspect ratio", async () => {
      const source = encodePng({
        width: 4,
        height: 2,
        data: new Uint8Array([
          255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255, 255,
          0, 255, 255, 0, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255,
        ]),
        depth: 8,
        channels: 4,
      });

      const preview = await createImagePreview(
        new Blob([source], { type: "image/png" }),
        "image/png",
        { maxDimension: 2 },
      );

      expect(preview).not.toBeNull();
      expect(preview!.contentType).toBe("image/png");
      expect(preview!.width).toBe(2);
      expect(preview!.height).toBe(1);
      expect(preview!.resized).toBe(true);

      const decoded = decodePng(await preview!.blob.arrayBuffer());
      expect(decoded.width).toBe(2);
      expect(decoded.height).toBe(1);
    });

    it("resizes 16-bit PNG previews within the max dimension while preserving aspect ratio", async () => {
      const source = encodePng({
        width: 4,
        height: 2,
        data: new Uint16Array([
          65535, 0, 0, 65535, 0, 65535, 0, 65535, 0, 0, 65535, 65535, 65535,
          65535, 0, 65535, 65535, 0, 65535, 65535, 0, 65535, 65535, 65535,
          65535, 65535, 65535, 65535, 0, 0, 0, 65535,
        ]),
        depth: 16,
        channels: 4,
      });

      const preview = await createImagePreview(
        new Blob([source], { type: "image/png" }),
        "image/png",
        { maxDimension: 2 },
      );

      expect(preview).not.toBeNull();
      expect(preview!.contentType).toBe("image/png");
      expect(preview!.width).toBe(2);
      expect(preview!.height).toBe(1);
      expect(preview!.resized).toBe(true);

      const decoded = decodePng(await preview!.blob.arrayBuffer());
      expect(decoded.width).toBe(2);
      expect(decoded.height).toBe(1);
      expect(decoded.depth).toBe(8);
    });

    it("resizes JPEG previews within the max dimension while preserving aspect ratio", async () => {
      const source = jpeg.encode(
        {
          width: 4,
          height: 2,
          data: new Uint8Array([
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
            255, 0, 255, 255, 0, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0,
            255,
          ]),
        },
        80,
      ).data;

      const preview = await createImagePreview(
        new Blob([source], { type: "image/jpeg" }),
        "image/jpeg",
        { maxDimension: 2 },
      );

      expect(preview).not.toBeNull();
      expect(preview!.contentType).toBe("image/jpeg");
      expect(preview!.width).toBe(2);
      expect(preview!.height).toBe(1);
      expect(preview!.resized).toBe(true);
    });

    it("returns original bytes when image is already within preview dimensions", async () => {
      const source = jpeg.encode(
        {
          width: 2,
          height: 1,
          data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
        },
        80,
      ).data;
      const blob = new Blob([source], { type: "image/jpeg" });

      const preview = await createImagePreview(blob, "image/jpeg", {
        maxDimension: 1024,
      });

      expect(preview).not.toBeNull();
      expect(preview!.blob).toBe(blob);
      expect(preview!.contentType).toBe("image/jpeg");
      expect(preview!.width).toBe(2);
      expect(preview!.height).toBe(1);
      expect(preview!.resized).toBe(false);
      expect(Buffer.from(await preview!.blob.arrayBuffer())).toEqual(
        Buffer.from(source),
      );
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
