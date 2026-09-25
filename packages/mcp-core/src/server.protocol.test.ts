import { createRequire } from "node:module";
import * as esmSdk from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const cjsSdk = require("@modelcontextprotocol/server") as typeof esmSdk;

// Exercise the SDK's HTTP error responses in Node. The Workers test runner
// reports rejected promises adopted by `.then()` as unhandled even when the
// protocol catches them and sends the response. Header validation is covered
// separately through the hosted handler in mcp-cloudflare.
describe.each([
  ["ESM", esmSdk],
  ["CommonJS", cjsSdk],
] as const)("patched MCP SDK (%s)", (_format, sdk) => {
  it("requires the protocol version header for modern discovery", async () => {
    const handler = sdk.createMcpHandler(
      () => new sdk.McpServer({ name: "test-server", version: "1.0.0" }),
    );
    try {
      const response = await handler.fetch(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "Mcp-Method": "server/discover",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "server/discover",
            params: {
              _meta: {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": {},
              },
            },
          }),
        }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        id: 1,
        error: { code: -32020 },
      });
    } finally {
      await handler.close();
    }
  });

  describe.each(["2026-07-28", "2025-11-25"])(
    "HTTP request params (%s)",
    (version) => {
      async function listTools(cursor?: unknown, handlerThrows = false) {
        const handler = sdk.createMcpHandler(() => {
          const server = new sdk.McpServer(
            { name: "test-server", version: "1.0.0" },
            { capabilities: { tools: {} } },
          );
          server.server.setRequestHandler("tools/list", () => {
            if (handlerThrows) {
              throw new Error("Unexpected handler failure");
            }
            return { tools: [] };
          });
          return server;
        });
        const modern = version === "2026-07-28";
        try {
          const response = await handler.fetch(
            new Request("http://localhost/mcp", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json, text/event-stream",
                "MCP-Protocol-Version": version,
                ...(modern ? { "Mcp-Method": "tools/list" } : {}),
              },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "tools/list",
                params: {
                  ...(cursor === undefined ? {} : { cursor }),
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
            }),
          );
          expect(response.status).toBe(200);
          const body = await response.text();
          if (
            response.headers.get("content-type")?.includes("text/event-stream")
          ) {
            const data = body
              .split("\n")
              .find((line) => line.startsWith("data: "));
            if (!data) throw new Error("Missing SSE response message");
            return JSON.parse(data.slice(6));
          }
          return JSON.parse(body);
        } finally {
          await handler.close();
        }
      }

      it("returns InvalidParams for a malformed cursor", async () => {
        expect(await listTools(42)).toMatchObject({
          id: 1,
          error: { code: -32602 },
        });
      });

      it("still accepts a string cursor", async () => {
        expect(await listTools("next-page")).toMatchObject({
          id: 1,
          result: { tools: expect.any(Array) },
        });
      });

      it("keeps handler failures as InternalError", async () => {
        expect(await listTools(undefined, true)).toMatchObject({
          id: 1,
          error: { code: -32603 },
        });
      });
    },
  );
});
