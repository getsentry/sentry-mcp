/**
 * Tests for ProGuard upload infrastructure.
 *
 * Tests the raw-byte chunking used by the DIF upload protocol.
 * ProGuard mappings are chunked as raw bytes (no ZIP wrapping).
 */

import { describe, expect, test } from "vitest";
import { hashBuffer } from "../../../src/lib/api/chunk-upload.js";

describe("hashBuffer", () => {
  test("single chunk for small content", () => {
    const content = Buffer.from("void\n");
    const { chunks, overallChecksum } = hashBuffer(content, 8192);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.offset).toBe(0);
    expect(chunks[0]?.size).toBe(5);
    expect(chunks[0]?.sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(overallChecksum).toMatch(/^[0-9a-f]{40}$/);
    // Single chunk: chunk sha1 === overall checksum
    expect(chunks[0]?.sha1).toBe(overallChecksum);
  });

  test("splits into multiple chunks when content exceeds chunkSize", () => {
    const content = Buffer.alloc(100, "a");
    const { chunks, overallChecksum } = hashBuffer(content, 30);

    // 100 bytes / 30 per chunk = 4 chunks (30 + 30 + 30 + 10)
    expect(chunks).toHaveLength(4);
    expect(chunks[0]?.offset).toBe(0);
    expect(chunks[0]?.size).toBe(30);
    expect(chunks[1]?.offset).toBe(30);
    expect(chunks[1]?.size).toBe(30);
    expect(chunks[2]?.offset).toBe(60);
    expect(chunks[2]?.size).toBe(30);
    expect(chunks[3]?.offset).toBe(90);
    expect(chunks[3]?.size).toBe(10);
    expect(overallChecksum).toMatch(/^[0-9a-f]{40}$/);
  });

  test("overall checksum is deterministic", () => {
    const content = Buffer.from("com.example.MyClass -> a:\n");
    const result1 = hashBuffer(content, 8192);
    const result2 = hashBuffer(content, 8192);

    expect(result1.overallChecksum).toBe(result2.overallChecksum);
    expect(result1.chunks).toHaveLength(result2.chunks.length);
  });

  test("different content yields different checksums", () => {
    const content1 = Buffer.from("mapping one\n");
    const content2 = Buffer.from("mapping two\n");
    const result1 = hashBuffer(content1, 8192);
    const result2 = hashBuffer(content2, 8192);

    expect(result1.overallChecksum).not.toBe(result2.overallChecksum);
  });

  test("chunk SHA-1 checksums are valid hex strings", () => {
    const content = Buffer.alloc(200, "x");
    const { chunks } = hashBuffer(content, 50);

    for (const chunk of chunks) {
      expect(chunk.sha1).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  test("empty buffer yields no chunks", () => {
    const content = Buffer.alloc(0);
    const { chunks, overallChecksum } = hashBuffer(content, 8192);

    expect(chunks).toHaveLength(0);
    expect(overallChecksum).toMatch(/^[0-9a-f]{40}$/);
  });
});
