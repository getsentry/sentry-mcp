import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "../../app";

describe("/api/chat", () => {
  it("should return 401 without authorization", async () => {
    const res = await app.request(
      "/api/chat",
      {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: [] }),
      },
      env,
    );

    expect(res.status).toBe(401);
  });
});
