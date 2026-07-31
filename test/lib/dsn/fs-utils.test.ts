/**
 * Tests for DSN file system utilities.
 *
 * Verifies that handleFileError correctly distinguishes expected filesystem
 * errors (silently ignored) from unexpected ones (reported to Sentry).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { captureException } = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock("@sentry/node-core/light", () => ({
  captureException,
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
}));

const { handleFileError } = await import("../../../src/lib/dsn/fs-utils.js");

/** Create an Error with a `code` property, mimicking Node/Bun errno errors. */
function errnoError(code: string, message?: string): Error {
  const err = new Error(message ?? code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe("handleFileError", () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  afterEach(() => {
    captureException.mockClear();
  });

  describe("ignorable errors (should NOT report to Sentry)", () => {
    test("ENOENT — file does not exist", () => {
      handleFileError(errnoError("ENOENT"), {
        operation: "test",
        path: "/missing",
      });
      expect(captureException).not.toHaveBeenCalled();
    });

    test("EACCES — permission denied", () => {
      handleFileError(errnoError("EACCES"), {
        operation: "test",
        path: "/secret",
      });
      expect(captureException).not.toHaveBeenCalled();
    });

    test("EPERM — operation not permitted", () => {
      handleFileError(errnoError("EPERM"), {
        operation: "test",
        path: "/locked",
      });
      expect(captureException).not.toHaveBeenCalled();
    });

    test("EISDIR — path is a directory, not a file", () => {
      handleFileError(
        errnoError("EISDIR", "Directories cannot be read like files"),
        {
          operation: "checkEnvForDsn",
          path: "/project/.env",
        }
      );
      expect(captureException).not.toHaveBeenCalled();
    });

    test("ENOTDIR — path component is not a directory", () => {
      handleFileError(errnoError("ENOTDIR"), {
        operation: "test",
        path: "/file.txt/child",
      });
      expect(captureException).not.toHaveBeenCalled();
    });
  });

  describe("unexpected errors (SHOULD report to Sentry)", () => {
    test("EIO — I/O error", () => {
      handleFileError(errnoError("EIO"), {
        operation: "test",
        path: "/disk-fail",
      });
      expect(captureException).toHaveBeenCalledTimes(1);
    });

    test("ENOMEM — out of memory", () => {
      handleFileError(errnoError("ENOMEM"), { operation: "test" });
      expect(captureException).toHaveBeenCalledTimes(1);
    });

    test("generic Error without code", () => {
      handleFileError(new Error("something broke"), { operation: "test" });
      expect(captureException).toHaveBeenCalledTimes(1);
    });

    test("non-Error value", () => {
      handleFileError("string error", { operation: "test" });
      expect(captureException).toHaveBeenCalledTimes(1);
    });
  });

  test("passes context tags and extras to Sentry", () => {
    const error = errnoError("EIO");
    handleFileError(error, {
      operation: "checkEnvForDsn",
      path: "/project/.env",
    });
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { operation: "checkEnvForDsn" },
      extra: { path: "/project/.env" },
    });
  });
});
