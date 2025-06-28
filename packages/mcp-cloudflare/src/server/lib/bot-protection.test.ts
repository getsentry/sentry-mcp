import { describe, it, expect, vi } from "vitest";
import { withBotProtection } from "./bot-protection";
import type { Env } from "../types";
import type { IncomingRequestCfProperties } from "@cloudflare/workers-types";

describe("bot-protection", () => {
  const mockEnv = {} as Env;
  const mockCtx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as ExecutionContext;

  const mockHandler: ExportedHandler<Env> = {
    fetch: vi.fn().mockResolvedValue(new Response("OK")),
  };

  // Helper to create test requests with the proper type
  const createTestRequest = (
    url: string,
    init?: RequestInit,
  ): Request<unknown, IncomingRequestCfProperties<unknown>> => {
    return new Request(url, init) as Request<
      unknown,
      IncomingRequestCfProperties<unknown>
    >;
  };

  describe("withBotProtection", () => {
    it("should block generic Python requests user agent", async () => {
      const wrappedHandler = withBotProtection(mockHandler);
      const request = createTestRequest("https://example.com", {
        headers: {
          "user-agent": "python-requests/2.31.0",
        },
      });

      const response = await wrappedHandler.fetch!(request, mockEnv, mockCtx);

      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Access denied");
      expect(mockHandler.fetch).not.toHaveBeenCalled();
    });

    it("should block Go http client user agent", async () => {
      const wrappedHandler = withBotProtection(mockHandler);
      const request = createTestRequest("https://example.com", {
        headers: {
          "user-agent": "Go-http-client/1.1",
        },
      });

      const response = await wrappedHandler.fetch!(request, mockEnv, mockCtx);

      expect(response.status).toBe(403);
      expect(mockHandler.fetch).not.toHaveBeenCalled();
    });

    it("should block okhttp user agent", async () => {
      const wrappedHandler = withBotProtection(mockHandler);
      const request = createTestRequest("https://example.com", {
        headers: {
          "user-agent": "okhttp/4.9.3",
        },
      });

      const response = await wrappedHandler.fetch!(request, mockEnv, mockCtx);

      expect(response.status).toBe(403);
      expect(mockHandler.fetch).not.toHaveBeenCalled();
    });

    it("should block curl user agent", async () => {
      const wrappedHandler = withBotProtection(mockHandler);
      const request = createTestRequest("https://example.com", {
        headers: {
          "user-agent": "curl/7.68.0",
        },
      });

      const response = await wrappedHandler.fetch!(request, mockEnv, mockCtx);

      expect(response.status).toBe(403);
      expect(mockHandler.fetch).not.toHaveBeenCalled();
    });

    it("should block empty user agent", async () => {
      const wrappedHandler = withBotProtection(mockHandler);
      const request = createTestRequest("https://example.com", {
        headers: {},
      });

      const response = await wrappedHandler.fetch!(request, mockEnv, mockCtx);

      expect(response.status).toBe(403);
      expect(mockHandler.fetch).not.toHaveBeenCalled();
    });

    it("should block very short user agent", async () => {
      const wrappedHandler = withBotProtection(mockHandler);
      const request = createTestRequest("https://example.com", {
        headers: {
          "user-agent": "bot",
        },
      });

      const response = await wrappedHandler.fetch!(request, mockEnv, mockCtx);

      expect(response.status).toBe(403);
      expect(mockHandler.fetch).not.toHaveBeenCalled();
    });

    it("should allow Chrome browser user agent", async () => {
      const wrappedHandler = withBotProtection(mockHandler);
      const request = createTestRequest("https://example.com", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      const response = await wrappedHandler.fetch!(request, mockEnv, mockCtx);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("OK");
      expect(mockHandler.fetch).toHaveBeenCalledWith(request, mockEnv, mockCtx);
    });

    it("should allow Firefox browser user agent", async () => {
      const wrappedHandler = withBotProtection(mockHandler);
      const request = createTestRequest("https://example.com", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
        },
      });

      const response = await wrappedHandler.fetch!(request, mockEnv, mockCtx);

      expect(response.status).toBe(200);
      expect(mockHandler.fetch).toHaveBeenCalled();
    });

    it("should allow Safari browser user agent", async () => {
      const wrappedHandler = withBotProtection(mockHandler);
      const request = createTestRequest("https://example.com", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
        },
      });

      const response = await wrappedHandler.fetch!(request, mockEnv, mockCtx);

      expect(response.status).toBe(200);
      expect(mockHandler.fetch).toHaveBeenCalled();
    });

    it("should allow Googlebot", async () => {
      const wrappedHandler = withBotProtection(mockHandler);
      const request = createTestRequest("https://example.com", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        },
      });

      const response = await wrappedHandler.fetch!(request, mockEnv, mockCtx);

      expect(response.status).toBe(200);
      expect(mockHandler.fetch).toHaveBeenCalled();
    });

    it("should allow Postman", async () => {
      const wrappedHandler = withBotProtection(mockHandler);
      const request = createTestRequest("https://example.com", {
        headers: {
          "user-agent": "PostmanRuntime/7.32.1",
        },
      });

      const response = await wrappedHandler.fetch!(request, mockEnv, mockCtx);

      expect(response.status).toBe(200);
      expect(mockHandler.fetch).toHaveBeenCalled();
    });

    it("should allow UptimeRobot monitoring", async () => {
      const wrappedHandler = withBotProtection(mockHandler);
      const request = createTestRequest("https://example.com", {
        headers: {
          "user-agent":
            "Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)",
        },
      });

      const response = await wrappedHandler.fetch!(request, mockEnv, mockCtx);

      expect(response.status).toBe(200);
      expect(mockHandler.fetch).toHaveBeenCalled();
    });

    it("should pass through other handler methods", () => {
      const scheduledHandler = vi.fn();
      const queueHandler = vi.fn();
      const tailHandler = vi.fn();
      const traceHandler = vi.fn();
      const emailHandler = vi.fn();

      const handler: ExportedHandler<Env> = {
        fetch: vi.fn(),
        scheduled: scheduledHandler,
        queue: queueHandler,
        tail: tailHandler,
        trace: traceHandler,
        email: emailHandler,
      };

      const wrappedHandler = withBotProtection(handler);

      expect(wrappedHandler.scheduled).toBe(scheduledHandler);
      expect(wrappedHandler.queue).toBe(queueHandler);
      expect(wrappedHandler.tail).toBe(tailHandler);
      expect(wrappedHandler.trace).toBe(traceHandler);
      expect(wrappedHandler.email).toBe(emailHandler);
    });

    it("should return 501 if no fetch handler provided", async () => {
      const handlerWithoutFetch: ExportedHandler<Env> = {};
      const wrappedHandler = withBotProtection(handlerWithoutFetch);

      const request = createTestRequest("https://example.com", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      const response = await wrappedHandler.fetch!(request, mockEnv, mockCtx);

      expect(response.status).toBe(501);
      expect(await response.text()).toBe("Not implemented");
    });
  });
});
