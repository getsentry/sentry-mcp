/**
 * Test setup for Cloudflare Workers tests.
 *
 * Keep setup-file work limited to runtime-agnostic polyfills and network mocks.
 * Cloudflare worker-specific test APIs must be imported from actual test files.
 */
import { afterAll, afterEach, beforeAll } from "vitest";
import "urlpattern-polyfill";
import {
  docsHandlers,
  restHandlers,
  searchHandlers,
} from "@sentry/mcp-server-mocks/handlers";
import { userFixture } from "@sentry/mcp-server-mocks/payloads";
import { HttpResponse, http } from "msw";
import { DIRECT_AUTH_ASSERTION_TOKEN } from "./test-utils/direct-auth";
import { network } from "./test-utils/network";

/**
 * Metadata route self-fetches the worker's `/mcp` endpoint over HTTP.
 * Under `@msw/cloudflare`, that loopback call is intercepted and cannot
 * passthrough to the real worker dispatcher, so keep a minimal MCP mock.
 */
const localMcpHandlers = [
  http.post("http://localhost/mcp", async ({ request }) => {
    const body = (await request.json()) as {
      id?: string | number | null;
      method?: string;
    };

    if (body.method === "initialize") {
      return HttpResponse.json({
        jsonrpc: "2.0",
        id: body.id ?? null,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "sentry-mcp-test", version: "0.0.0" },
        },
      });
    }

    if (body.method === "tools/list") {
      return HttpResponse.json({
        jsonrpc: "2.0",
        id: body.id ?? null,
        result: { tools: [] },
      });
    }

    if (body.method === "notifications/initialized") {
      return new HttpResponse(null, { status: 202 });
    }

    return HttpResponse.json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      result: {},
    });
  }),
  http.get("http://localhost/mcp", () => {
    return new HttpResponse(null, { status: 405 });
  }),
];

const directTokenHandlers = [
  http.get("https://direct-token.test/api/0/auth/", ({ request }) => {
    const authorization = request.headers.get("authorization");
    if (authorization !== `Bearer ${DIRECT_AUTH_ASSERTION_TOKEN}`) {
      return HttpResponse.json(
        { detail: "Unexpected direct-token Authorization header" },
        { status: 401 },
      );
    }
    if (request.headers.get("x-sentry-mcp-utm-source") !== "plugin") {
      return HttpResponse.json(
        { detail: "Missing MCP UTM source header" },
        { status: 400 },
      );
    }
    return HttpResponse.json(userFixture);
  }),
];

const sharedHandlers = [
  ...restHandlers,
  ...searchHandlers,
  ...docsHandlers,
  ...directTokenHandlers,
  ...localMcpHandlers,
];

beforeAll(() => {
  network.enable();
  network.use(...sharedHandlers);
});

afterEach(() => {
  network.resetHandlers();
  network.use(...sharedHandlers);
});

afterAll(() => {
  network.disable();
});
