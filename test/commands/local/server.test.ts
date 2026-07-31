/**
 * Tests for the `sentry local serve` command infrastructure.
 *
 * Exercises buildApp (HTTP ingest, SSE streaming, CORS), isServerRunning,
 * feedSSELine, and parsePort.
 */

import { createSpotlightBuffer } from "@spotlightjs/spotlight/sdk";
import { describe, expect, test } from "vitest";
import {
  buildApp,
  feedSSELine,
  isServerRunning,
  parsePort,
} from "../../../src/commands/local/server.js";
import { ValidationError } from "../../../src/lib/errors.js";
import { SENTRY_CONTENT_TYPE } from "../../../src/lib/formatters/local.js";

describe("parsePort", () => {
  test("parses valid port numbers", () => {
    expect(parsePort("8969")).toBe(8969);
    expect(parsePort("0")).toBe(0);
    expect(parsePort("65535")).toBe(65_535);
  });

  test("throws on negative port", () => {
    expect(() => parsePort("-1")).toThrow(ValidationError);
  });

  test("throws on port above 65535", () => {
    expect(() => parsePort("70000")).toThrow(ValidationError);
  });

  test("throws on non-integer", () => {
    expect(() => parsePort("8969.5")).toThrow(ValidationError);
  });

  test("throws on non-numeric", () => {
    expect(() => parsePort("abc")).toThrow();
  });
});

describe("feedSSELine", () => {
  function makeState() {
    return { eventType: "", dataLines: [], id: "" };
  }

  test("parses event type", () => {
    const state = makeState();
    const events: Array<{ type: string; data: string; id: string }> = [];
    feedSSELine(
      "event: application/x-sentry-envelope",
      state,
      (type, data, id) => events.push({ type, data, id })
    );
    expect(state.eventType).toBe("application/x-sentry-envelope");
    expect(events).toHaveLength(0);
  });

  test("parses data lines", () => {
    const state = makeState();
    const events: Array<{ type: string; data: string; id: string }> = [];
    feedSSELine("data: hello", state, (type, data, id) =>
      events.push({ type, data, id })
    );
    expect(state.dataLines).toEqual(["hello"]);
    expect(events).toHaveLength(0);
  });

  test("parses id field", () => {
    const state = makeState();
    const events: Array<{ type: string; data: string; id: string }> = [];
    feedSSELine("id: abc-123", state, (type, data, id) =>
      events.push({ type, data, id })
    );
    expect(state.id).toBe("abc-123");
  });

  test("dispatches event on empty line", () => {
    const state = makeState();
    const events: Array<{ type: string; data: string; id: string }> = [];
    const cb = (type: string, data: string, id: string) =>
      events.push({ type, data, id });

    feedSSELine("event: test-event", state, cb);
    feedSSELine("id: evt-1", state, cb);
    feedSSELine("data: payload", state, cb);
    feedSSELine("", state, cb);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "test-event",
      data: "payload",
      id: "evt-1",
    });
  });

  test("resets state after dispatch", () => {
    const state = makeState();
    const events: Array<{ type: string; data: string; id: string }> = [];
    const cb = (type: string, data: string, id: string) =>
      events.push({ type, data, id });

    feedSSELine("event: first", state, cb);
    feedSSELine("data: one", state, cb);
    feedSSELine("", state, cb);

    expect(state.eventType).toBe("");
    expect(state.dataLines).toEqual([]);
    expect(state.id).toBe("");
  });

  test("concatenates multiple data lines with newline", () => {
    const state = makeState();
    const events: Array<{ type: string; data: string; id: string }> = [];
    const cb = (type: string, data: string, id: string) =>
      events.push({ type, data, id });

    feedSSELine("data: line1", state, cb);
    feedSSELine("data: line2", state, cb);
    feedSSELine("", state, cb);

    expect(events[0]?.data).toBe("line1\nline2");
  });

  test("does not dispatch on empty line with no data", () => {
    const state = makeState();
    const events: Array<{ type: string; data: string; id: string }> = [];
    feedSSELine("", state, (type, data, id) => events.push({ type, data, id }));
    expect(events).toHaveLength(0);
  });

  test("handles data without leading space", () => {
    const state = makeState();
    const events: Array<{ type: string; data: string; id: string }> = [];
    const cb = (type: string, data: string, id: string) =>
      events.push({ type, data, id });

    feedSSELine("data:nospace", state, cb);
    feedSSELine("", state, cb);

    expect(events[0]?.data).toBe("nospace");
  });
});

describe("buildApp", () => {
  test("health endpoint returns OK", async () => {
    const buffer = createSpotlightBuffer(10);
    const app = buildApp(buffer);

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  test("ingest endpoint accepts envelopes and returns 204", async () => {
    const buffer = createSpotlightBuffer(10);
    const app = buildApp(buffer);

    const envelope =
      '{"sdk":{"name":"sentry.node"}}\n{"type":"event"}\n{"message":"test"}';
    const res = await app.request("/stream", {
      method: "POST",
      headers: { "Content-Type": SENTRY_CONTENT_TYPE },
      body: envelope,
    });
    expect(res.status).toBe(204);
  });

  test("ingest via /api/:projectId/envelope/ returns 204", async () => {
    const buffer = createSpotlightBuffer(10);
    const app = buildApp(buffer);

    const envelope =
      '{"sdk":{"name":"sentry.node"}}\n{"type":"event"}\n{"message":"test"}';
    const res = await app.request("/api/123/envelope/", {
      method: "POST",
      headers: { "Content-Type": SENTRY_CONTENT_TYPE },
      body: envelope,
    });
    expect(res.status).toBe(204);
  });

  test("ingest rejects oversized payloads with 413", async () => {
    const buffer = createSpotlightBuffer(10);
    const app = buildApp(buffer);

    const res = await app.request("/stream", {
      method: "POST",
      headers: {
        "Content-Type": SENTRY_CONTENT_TYPE,
        "Content-Length": String(11 * 1024 * 1024),
      },
      body: "x".repeat(1024),
    });
    expect(res.status).toBe(413);
  });

  test("CORS allows localhost origins", async () => {
    const buffer = createSpotlightBuffer(10);
    const app = buildApp(buffer);

    const res = await app.request("/health", {
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000"
    );
  });

  test("CORS blocks non-localhost origins", async () => {
    const buffer = createSpotlightBuffer(10);
    const app = buildApp(buffer);

    const res = await app.request("/health", {
      headers: { Origin: "http://evil.example.com" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("SSE stream endpoint returns event-stream content type", async () => {
    const buffer = createSpotlightBuffer(10);
    const app = buildApp(buffer);

    const res = await app.request("/stream", {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // Abort to avoid hanging
    if (res.body) {
      await res.body.cancel();
    }
  });
});

describe("isServerRunning", () => {
  test("returns false when no server is running", async () => {
    // isServerRunning uses global fetch which is mocked in tests.
    // Verify the function handles connection errors gracefully.
    const result = await isServerRunning("http://127.0.0.1:19999");
    expect(result).toBe(false);
  });
});
