import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFatalHandler, ignoreBrokenStdioStreamErrors } from "./fatal";

describe("createFatalHandler", () => {
  let exit: ReturnType<typeof vi.fn>;
  let captureException: ReturnType<typeof vi.fn>;
  let flush: ReturnType<typeof vi.fn>;
  let logError: ReturnType<typeof vi.fn>;
  let scheduled: Array<() => void>;

  beforeEach(() => {
    exit = vi.fn();
    captureException = vi.fn();
    flush = vi.fn(() => Promise.resolve(true));
    logError = vi.fn();
    scheduled = [];
  });

  function makeHandler() {
    return createFatalHandler({
      timeoutMs: 50,
      captureException,
      flush,
      logError,
      exit,
      setExitTimeout: (fn) => {
        scheduled.push(fn);
        return { unref: vi.fn() };
      },
    });
  }

  it("logs, reports, flushes, and exits on the first fatal error", async () => {
    const onFatal = makeHandler();
    const err = new Error("boom");

    onFatal(err, "Uncaught exception:");

    expect(logError).toHaveBeenCalledWith("Uncaught exception:", err);
    expect(captureException).toHaveBeenCalledWith(err);
    expect(scheduled).toHaveLength(1);

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(flush).toHaveBeenCalledWith(50);
  });

  it("exits immediately on re-entrant fatal errors without logging again", () => {
    const onFatal = makeHandler();
    // Make logging itself trigger another fatal (broken stderr shape)
    logError.mockImplementation(() => {
      onFatal(new Error("epipe from log"));
    });

    onFatal(new Error("first"));

    expect(exit).toHaveBeenCalledWith(1);
    // outer log attempted once; re-entrant call bailed before a second log
    expect(logError).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("default logError swallows console failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    });

    const onFatal = createFatalHandler({
      timeoutMs: 50,
      captureException,
      flush,
      exit,
      setExitTimeout: (fn) => {
        scheduled.push(fn);
        return { unref: vi.fn() };
      },
    });

    expect(() => onFatal(new Error("root"))).not.toThrow();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(captureException).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("exits via timeout if flush never resolves", () => {
    flush.mockReturnValue(new Promise(() => {}));
    const onFatal = makeHandler();

    onFatal(new Error("hang"));
    expect(exit).not.toHaveBeenCalled();

    scheduled[0]();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("still exits when captureException throws", async () => {
    captureException.mockImplementation(() => {
      throw new Error("sentry down");
    });
    const onFatal = makeHandler();

    expect(() => onFatal(new Error("root"))).not.toThrow();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it("still exits when flush rejects", async () => {
    flush.mockReturnValue(Promise.reject(new Error("flush failed")));
    const onFatal = makeHandler();

    onFatal(new Error("root"));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});

describe("ignoreBrokenStdioStreamErrors", () => {
  it("swallows EPIPE and ERR_STREAM_DESTROYED without throwing", () => {
    const stream = new EventEmitter() as EventEmitter & {
      on: EventEmitter["on"];
    };
    ignoreBrokenStdioStreamErrors([stream as never]);

    expect(() =>
      stream.emit(
        "error",
        Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
      ),
    ).not.toThrow();
    expect(() =>
      stream.emit(
        "error",
        Object.assign(new Error("destroyed"), { code: "ERR_STREAM_DESTROYED" }),
      ),
    ).not.toThrow();
  });
});
