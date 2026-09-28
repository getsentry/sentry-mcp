import { describe, it, expect } from "vitest";
import { isRegisteredRedirectUri } from "./redirect-uri";

describe("isRegisteredRedirectUri", () => {
  describe("loopback URIs (RFC 8252 Section 7.3)", () => {
    it("accepts an ephemeral port against a portless localhost registration", () => {
      expect(
        isRegisteredRedirectUri("http://localhost:3118/callback", [
          "http://localhost/callback",
        ]),
      ).toBe(true);
    });

    it("accepts an ephemeral port against a portless 127.0.0.1 registration", () => {
      expect(
        isRegisteredRedirectUri("http://127.0.0.1:62210/callback", [
          "http://127.0.0.1/callback",
        ]),
      ).toBe(true);
    });

    it("accepts an ephemeral port against an IPv6 loopback registration", () => {
      expect(
        isRegisteredRedirectUri("http://[::1]:8080/callback", [
          "http://[::1]/callback",
        ]),
      ).toBe(true);
    });

    it("accepts a differing port when the registration also has one", () => {
      expect(
        isRegisteredRedirectUri("http://localhost:3118/callback", [
          "http://localhost:1455/callback",
        ]),
      ).toBe(true);
    });

    it("matches against a later entry in the registered list", () => {
      expect(
        isRegisteredRedirectUri("http://127.0.0.1:3118/callback", [
          "http://localhost/callback",
          "http://127.0.0.1/callback",
        ]),
      ).toBe(true);
    });

    it("rejects a differing path", () => {
      expect(
        isRegisteredRedirectUri("http://localhost:3118/evil", [
          "http://localhost/callback",
        ]),
      ).toBe(false);
    });

    it("rejects a differing query string", () => {
      expect(
        isRegisteredRedirectUri("http://localhost:3118/callback?next=evil", [
          "http://localhost/callback",
        ]),
      ).toBe(false);
    });

    it("rejects a differing scheme", () => {
      expect(
        isRegisteredRedirectUri("https://localhost:3118/callback", [
          "http://localhost/callback",
        ]),
      ).toBe(false);
    });

    it("rejects a non-loopback host that merely embeds a loopback name", () => {
      expect(
        isRegisteredRedirectUri("http://localhost.evil.com:3118/callback", [
          "http://localhost/callback",
        ]),
      ).toBe(false);
    });

    it("rejects a non-loopback request against a loopback registration", () => {
      expect(
        isRegisteredRedirectUri("http://evil.com:3118/callback", [
          "http://localhost/callback",
        ]),
      ).toBe(false);
    });
  });

  describe("non-loopback URIs", () => {
    it("accepts an exact match", () => {
      expect(
        isRegisteredRedirectUri("https://example.com/callback", [
          "https://example.com/callback",
        ]),
      ).toBe(true);
    });

    it("rejects a differing port", () => {
      expect(
        isRegisteredRedirectUri("https://example.com:8443/callback", [
          "https://example.com/callback",
        ]),
      ).toBe(false);
    });

    it("rejects a differing path", () => {
      expect(
        isRegisteredRedirectUri("https://example.com/evil", [
          "https://example.com/callback",
        ]),
      ).toBe(false);
    });
  });

  describe("malformed input", () => {
    it("rejects when the registered list is undefined", () => {
      expect(
        isRegisteredRedirectUri("http://localhost:3118/callback", undefined),
      ).toBe(false);
    });

    it("rejects when the registered list is empty", () => {
      expect(
        isRegisteredRedirectUri("http://localhost:3118/callback", []),
      ).toBe(false);
    });

    it("rejects an unparseable request URI", () => {
      expect(
        isRegisteredRedirectUri("not-a-uri", ["http://localhost/callback"]),
      ).toBe(false);
    });

    it("rejects an unparseable registered URI", () => {
      expect(
        isRegisteredRedirectUri("http://localhost:3118/callback", [
          "not-a-uri",
        ]),
      ).toBe(false);
    });
  });
});
