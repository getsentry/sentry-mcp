import { describe, it, expect } from "vitest";
import app from "./app";

describe("app", () => {
  describe("GET /robots.txt", () => {
    it("should return correct robots.txt content", async () => {
      const res = await app.request("/robots.txt");

      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toBe(
        ["User-agent: *", "Allow: /$", "Disallow: /"].join("\n"),
      );
    });
  });

  describe("GET /llms.txt", () => {
    it("should return correct llms.txt content", async () => {
      const res = await app.request("/llms.txt");

      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain("# sentry-mcp");
      expect(text).toContain("Model Context Protocol");
    });
  });
});
