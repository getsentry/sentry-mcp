/**
 * Tests for the chunk-upload server-options schema.
 *
 * Focuses on the optional `maxFileSize` / `maxWait` fields added for
 * `debug-files upload`: a server response that omits them must still parse
 * (backward compatibility), and present values must be carried through.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ChunkServerOptionsSchema,
  pollAssembly,
} from "../../../src/lib/api/chunk-upload.js";
import { apiRequestToRegion } from "../../../src/lib/api/infrastructure.js";

vi.mock("../../../src/lib/api/infrastructure.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/lib/api/infrastructure.js")
    >();
  return { ...actual, apiRequestToRegion: vi.fn() };
});
const apiMock = vi.mocked(apiRequestToRegion);

const BASE = {
  url: "https://us.sentry.io/api/0/chunk-upload/",
  chunkSize: 8192,
  chunksPerRequest: 64,
  maxRequestSize: 1_048_576,
  hashAlgorithm: "sha1",
  concurrency: 8,
  compression: ["gzip"],
};

describe("ChunkServerOptionsSchema", () => {
  test("parses a response that omits maxFileSize and maxWait", () => {
    const result = ChunkServerOptionsSchema.safeParse(BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxFileSize).toBeUndefined();
      expect(result.data.maxWait).toBeUndefined();
    }
  });

  test("carries through present maxFileSize and maxWait", () => {
    const result = ChunkServerOptionsSchema.safeParse({
      ...BASE,
      maxFileSize: 2_147_483_648,
      maxWait: 300,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxFileSize).toBe(2_147_483_648);
      expect(result.data.maxWait).toBe(300);
    }
  });
});

describe("pollAssembly: waitForOk", () => {
  const params = {
    regionUrl: "https://us.sentry.io",
    endpoint: "org/artifactbundle/assemble/",
    body: {},
    entityName: "Artifact bundle",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    apiMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("default (waitForOk=false) returns as soon as state is 'created'", async () => {
    apiMock.mockResolvedValue({
      data: { state: "created" },
    } as unknown as Awaited<ReturnType<typeof apiRequestToRegion>>);
    const promise = pollAssembly(params);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBeUndefined();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  test("waitForOk=true keeps polling through 'created' until 'ok'", async () => {
    apiMock
      .mockResolvedValueOnce({
        data: { state: "created" },
      } as unknown as Awaited<ReturnType<typeof apiRequestToRegion>>)
      .mockResolvedValueOnce({
        data: { state: "ok" },
      } as unknown as Awaited<ReturnType<typeof apiRequestToRegion>>);
    const promise = pollAssembly({ ...params, waitForOk: true });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBeUndefined();
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
});
