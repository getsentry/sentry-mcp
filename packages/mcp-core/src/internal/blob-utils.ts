export async function blobToBase64(blob: Blob): Promise<string> {
  return Buffer.from(await blob.arrayBuffer()).toString("base64");
}

const MAGIC_SIGNATURES: { mime: string; offsets: [number, number][] }[] = [
  {
    mime: "image/png",
    offsets: [
      [0, 0x89],
      [1, 0x50],
      [2, 0x4e],
      [3, 0x47],
    ],
  },
  {
    mime: "image/jpeg",
    offsets: [
      [0, 0xff],
      [1, 0xd8],
      [2, 0xff],
    ],
  },
  {
    mime: "image/gif",
    offsets: [
      [0, 0x47],
      [1, 0x49],
      [2, 0x46],
      [3, 0x38],
    ],
  },
  {
    mime: "image/webp",
    offsets: [
      [0, 0x52],
      [1, 0x49],
      [2, 0x46],
      [3, 0x46],
      [8, 0x57],
      [9, 0x45],
      [10, 0x42],
      [11, 0x50],
    ],
  },
];

export async function detectImageMimeType(blob: Blob): Promise<string | null> {
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  for (const { mime, offsets } of MAGIC_SIGNATURES) {
    if (offsets.every(([offset, byte]) => header[offset] === byte)) {
      return mime;
    }
  }
  return null;
}
