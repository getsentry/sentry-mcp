import { describe, it, expect } from "vitest";
import { getClientIp } from "./client-ip";

describe("getClientIp", () => {
  it("returns CF-Connecting-IP when available", () => {
    const request = new Request("https://example.com", {
      headers: {
        "CF-Connecting-IP": "192.0.2.1",
        "X-Real-IP": "192.0.2.2",
        "X-Forwarded-For": "192.0.2.3, 192.0.2.4",
      },
    });

    expect(getClientIp(request)).toBe("192.0.2.1");
  });

  it("returns X-Real-IP when CF-Connecting-IP not available", () => {
    const request = new Request("https://example.com", {
      headers: {
        "X-Real-IP": "192.0.2.2",
        "X-Forwarded-For": "192.0.2.3, 192.0.2.4",
      },
    });

    expect(getClientIp(request)).toBe("192.0.2.2");
  });

  it("returns first IP from X-Forwarded-For when others not available", () => {
    const request = new Request("https://example.com", {
      headers: {
        "X-Forwarded-For": "192.0.2.3, 192.0.2.4, 192.0.2.5",
      },
    });

    expect(getClientIp(request)).toBe("192.0.2.3");
  });

  it("trims whitespace from X-Forwarded-For IP", () => {
    const request = new Request("https://example.com", {
      headers: {
        "X-Forwarded-For": "  192.0.2.3  , 192.0.2.4",
      },
    });

    expect(getClientIp(request)).toBe("192.0.2.3");
  });

  it("returns null when no IP headers present", () => {
    const request = new Request("https://example.com");

    expect(getClientIp(request)).toBe(null);
  });

  it("returns null when X-Forwarded-For is empty", () => {
    const request = new Request("https://example.com", {
      headers: {
        "X-Forwarded-For": "",
      },
    });

    expect(getClientIp(request)).toBe(null);
  });
});
