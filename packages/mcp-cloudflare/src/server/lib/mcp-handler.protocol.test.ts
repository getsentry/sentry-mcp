import type {
  ExecutionContext,
  IncomingRequestCfProperties,
} from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import mcpHandler from "./mcp-handler";

const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSION = "2025-11-25";

function createRequest(
  method: string,
  params: Record<string, unknown> = {},
  version = MODERN_VERSION,
): Request<unknown, IncomingRequestCfProperties> {
  const modern = version !== LEGACY_VERSION;
  return new Request<unknown, IncomingRequestCfProperties>(
    "http://localhost/mcp",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Host: "localhost",
        "MCP-Protocol-Version": version,
        ...(modern ? { "Mcp-Method": method } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          ...(modern
            ? {
                _meta: {
                  "io.modelcontextprotocol/protocolVersion": version,
                  "io.modelcontextprotocol/clientCapabilities": {},
                },
              }
            : {}),
        },
      }),
    },
  );
}

async function fetchHosted(
  request: Request<unknown, IncomingRequestCfProperties>,
): Promise<Response> {
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
    props: {
      id: "test-user",
      clientId: "test-client",
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      grantedSkills: ["inspect"],
    },
  } as ExecutionContext;
  return mcpHandler.fetch!(request, { SENTRY_HOST: "sentry.io" } as Env, ctx);
}

async function readMessage(response: Response) {
  const body = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = body.split("\n").find((line) => line.startsWith("data: "));
    if (!data) throw new Error("Missing SSE response message");
    return JSON.parse(data.slice(6));
  }
  return JSON.parse(body);
}

describe("hosted MCP protocol validation", () => {
  it("serves a valid modern request with complete result and caching hints", async () => {
    const response = await fetchHosted(createRequest("tools/list"));
    expect(response.status).toBe(200);
    expect(await readMessage(response)).toMatchObject({
      id: 1,
      result: {
        resultType: "complete",
        ttlMs: 0,
        cacheScope: "private",
        tools: expect.any(Array),
      },
    });
  });

  it.each([false, true])(
    "rejects a missing modern version header (method header also missing: %s)",
    async (omitMethod) => {
      const request = createRequest("tools/list");
      request.headers.delete("MCP-Protocol-Version");
      if (omitMethod) request.headers.delete("Mcp-Method");

      const response = await fetchHosted(request);
      expect(response.status).toBe(400);
      expect(await readMessage(response)).toMatchObject({
        id: 1,
        error: {
          code: -32020,
          message: expect.stringContaining(
            "MCP-Protocol-Version header is absent",
          ),
        },
      });
    },
  );

  it("preserves unsupported-version precedence over a missing header", async () => {
    const request = createRequest("tools/list", {}, "2099-01-01");
    request.headers.delete("MCP-Protocol-Version");
    const response = await fetchHosted(request);
    expect(response.status).toBe(400);
    expect(await readMessage(response)).toMatchObject({
      id: 1,
      error: { code: -32022 },
    });
  });

  it("still accepts a legacy initialize without the version header", async () => {
    const request = createRequest(
      "initialize",
      {
        protocolVersion: LEGACY_VERSION,
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
      LEGACY_VERSION,
    );
    request.headers.delete("MCP-Protocol-Version");
    const response = await fetchHosted(request);
    expect(response.status).toBe(200);
    expect(await readMessage(response)).toMatchObject({
      id: 1,
      result: { protocolVersion: LEGACY_VERSION },
    });
  });

  describe.each([MODERN_VERSION, LEGACY_VERSION])("%s", (version) => {
    it("keeps unsupported resources as MethodNotFound", async () => {
      const response = await fetchHosted(
        createRequest("resources/list", {}, version),
      );
      expect(response.status).toBe(version === MODERN_VERSION ? 404 : 200);
      expect(await readMessage(response)).toMatchObject({
        id: 1,
        error: { code: -32601 },
      });
    });
  });
});
