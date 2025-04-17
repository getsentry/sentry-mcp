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
});
