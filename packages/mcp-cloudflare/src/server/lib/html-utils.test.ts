import { describe, it, expect } from "vitest";
import {
  redirectUriHasUserInfo,
  sanitizeHrefUrl,
  sanitizeHtml,
} from "./html-utils";

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

describe("redirectUriHasUserInfo", () => {
  describe("detects userinfo components", () => {
    it.each([
      ["https://mcp.sentry.dev@example.io/callback", "host-spoofing username"],
      ["https://user:pass@example.io/callback", "username and password"],
      ["https://user@example.com", "bare username"],
      [
        "https://mcp.sentry.dev%40example.io@example.net/callback",
        "encoded host",
      ],
    ])("flags %s (%s)", (input) => {
      expect(redirectUriHasUserInfo(input)).toBe(true);
    });
  });

  describe("allows legitimate redirect URIs", () => {
    it.each([
      ["https://example.com/callback", "basic HTTPS"],
      ["http://127.0.0.1:8765/callback", "loopback"],
      ["http://localhost:3000/callback", "localhost"],
      ["cursor://callback", "custom scheme"],
      ["https://example.com/callback?next=user@host", "userinfo only in query"],
    ])("allows %s (%s)", (input) => {
      expect(redirectUriHasUserInfo(input)).toBe(false);
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
