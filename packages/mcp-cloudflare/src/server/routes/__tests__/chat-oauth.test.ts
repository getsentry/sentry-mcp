import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "../../app";

describe("/api/auth OAuth flow", () => {
  describe("GET /api/auth/callback", () => {
    it("should return 400 when state parameter is missing", async () => {
      const res = await app.request(
        "/api/auth/callback?code=test-code",
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
          },
        },
        env,
      );

      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Authentication Failed");
      expect(html).toContain("Invalid state parameter");
    });

    it("should return 400 when state does not match stored state", async () => {
      const res = await app.request(
        "/api/auth/callback?code=test-code&state=wrong-state",
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
            Cookie: "chat_oauth_state=different-state",
          },
        },
        env,
      );

      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Authentication Failed");
      expect(html).toContain("Invalid state parameter");
    });

    it("should return 400 when code is missing but state is valid", async () => {
      const state = "valid-state-12345";
      const res = await app.request(
        `/api/auth/callback?state=${state}`,
        {
          headers: {
            "CF-Connecting-IP": "192.0.2.1",
            Cookie: `chat_oauth_state=${state}`,
          },
        },
        env,
      );

      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Authentication Failed");
      expect(html).toContain("No authorization code received");
    });
  });
});
