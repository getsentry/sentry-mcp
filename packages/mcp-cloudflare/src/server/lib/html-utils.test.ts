import { describe, it, expect } from "vitest";
import { sanitizeHrefUrl, sanitizeHtml } from "./html-utils";

describe("sanitizeHrefUrl", () => {
  describe("blocks dangerous URI schemes", () => {
    it.each([
      [
        "javascript:alert(document.domain)",
        "javascript: (exact exploit payload)",
      ],
      ["javascript:alert(1)", "javascript: minimal"],
      ["JAVASCRIPT:alert(1)", "javascript: uppercase"],
      ["JaVaScRiPt:alert(1)", "javascript: mixed case"],
      ["java\tscript:alert(1)", "javascript: with tab control character"],
      ["java\x00script:alert(1)", "javascript: with null byte"],
      ["data:text/html,<script>alert(1)</script>", "data: scheme"],
      ["vbscript:msgbox", "vbscript: scheme"],
      ["blob:https://example.com/uuid", "blob: scheme"],
      ["file:///etc/passwd", "file: scheme"],
      ["mailto:evil@example.com", "mailto: scheme"],
    ])("rejects %s (%s)", (input) => {
      expect(sanitizeHrefUrl(input)).toBe("");
    });
  });

  describe("rejects invalid URLs", () => {
    it.each([
      ["", "empty string"],
      ["not a url", "random text"],
      ["://missing-scheme", "missing scheme"],
    ])("rejects %s (%s)", (input) => {
      expect(sanitizeHrefUrl(input)).toBe("");
    });
  });

  describe("allows safe URLs", () => {
    it.each([
      ["https://example.com", "basic HTTPS"],
      ["https://github.com/getsentry/sentry-mcp", "HTTPS with path"],
      [
        "https://example.com/path?query=1&other=2#fragment",
        "HTTPS with query and fragment",
      ],
      ["http://localhost:3000", "HTTP localhost (dev)"],
      ["http://example.com", "basic HTTP"],
    ])("allows %s (%s)", (input) => {
      expect(sanitizeHrefUrl(input)).toBe(input);
    });
  });

  describe("handles whitespace and control characters", () => {
    it("trims leading/trailing whitespace from valid URLs", () => {
      expect(sanitizeHrefUrl("  https://example.com  ")).toBe(
        "https://example.com",
      );
    });

    it("rejects URLs with embedded control characters", () => {
      expect(sanitizeHrefUrl("\x01javascript:alert(1)")).toBe("");
    });
  });
});

describe("sanitizeHtml", () => {
  it("escapes HTML entities", () => {
    expect(sanitizeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );
  });

  it("escapes single quotes", () => {
    expect(sanitizeHtml("it's")).toBe("it&#039;s");
  });

  it("escapes ampersands", () => {
    expect(sanitizeHtml("a&b")).toBe("a&amp;b");
  });
});
