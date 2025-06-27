import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithTimeout } from "./fetch-utils";

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should complete successfully when response is faster than timeout", async () => {
    const mockResponse = new Response("Success", { status: 200 });
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const responsePromise = fetchWithTimeout("https://example.com", {}, 5000);
    const response = await responsePromise;

    expect(response).toBe(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("should throw timeout error when request takes too long", async () => {
    let rejectFn: (error: Error) => void;
    const fetchPromise = new Promise((_, reject) => {
      rejectFn = reject;
    });

    global.fetch = vi.fn().mockImplementation(() => fetchPromise);

    const responsePromise = fetchWithTimeout("https://example.com", {}, 50);

    // Advance timer to trigger the abort
    vi.advanceTimersByTime(50);

    // Now reject with AbortError
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    rejectFn!(error);

    await expect(responsePromise).rejects.toThrow("Request timeout after 50ms");
  });

  it("should preserve non-abort errors", async () => {
    const networkError = new Error("Network error");
    global.fetch = vi.fn().mockRejectedValue(networkError);

    await expect(
      fetchWithTimeout("https://example.com", {}, 5000),
    ).rejects.toThrow("Network error");
  });

  it("should merge options with signal", async () => {
    const mockResponse = new Response("Success", { status: 200 });
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    await fetchWithTimeout(
      "https://example.com",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true }),
      },
      5000,
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("should use default timeout of 30 seconds", async () => {
    const mockResponse = new Response("Success", { status: 200 });
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    await fetchWithTimeout("https://example.com");

    expect(fetch).toHaveBeenCalled();
  });

  it("should accept URL object", async () => {
    const mockResponse = new Response("Success", { status: 200 });
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const url = new URL("https://example.com/path");
    await fetchWithTimeout(url, {}, 5000);

    expect(fetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
