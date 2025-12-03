import type { KVNamespace } from "@cloudflare/workers-types";
import { describe, expect, it, vi, afterEach, afterAll } from "vitest";
import { withGrantWriteRetry } from "./kv-write-retry";

type MockKvNamespace = KVNamespace & {
  put: ReturnType<typeof vi.fn<KVNamespace["put"]>>;
};

const createMockKv = (): MockKvNamespace =>
  ({
    get: vi.fn(),
    getWithMetadata: vi.fn(),
    put: vi.fn<KVNamespace["put"]>(),
    delete: vi.fn(),
    list: vi.fn(),
  }) as unknown as MockKvNamespace;

describe("withGrantWriteRetry", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  it("passes through to the underlying KV for non-grant keys", async () => {
    const kv = createMockKv();
    kv.put.mockResolvedValue();
    const wrapped = withGrantWriteRetry(kv);

    await wrapped.put("session:123", "value");

    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("retries grant writes when a rate limit error occurs", async () => {
    vi.useFakeTimers();
    const kv = createMockKv();
    const rateLimitError = new Error("KV PUT failed: 429 Too Many Requests");
    kv.put.mockRejectedValueOnce(rateLimitError);
    kv.put.mockResolvedValueOnce();
    const wrapped = withGrantWriteRetry(kv);

    const putPromise = wrapped.put("grant:abc", "value");

    await vi.advanceTimersByTimeAsync(1000);
    await putPromise;

    expect(kv.put).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("surfaces errors after exhausting retries", async () => {
    vi.useFakeTimers();
    const kv = createMockKv();
    const errorMessage = "KV PUT failed: 429 Too Many Requests";
    kv.put.mockRejectedValue(new Error(errorMessage));
    const wrapped = withGrantWriteRetry(kv, { maxRetries: 1 });

    const putPromise = wrapped.put("grant:def", "value");
    const rejection = expect(putPromise).rejects.toThrow(errorMessage);

    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
    expect(kv.put).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
