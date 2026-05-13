export async function blobToBase64(blob: Blob): Promise<string> {
  return Buffer.from(await blob.arrayBuffer()).toString("base64");
}
