import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "./agent.js";
import type { MCPConnection } from "./types.js";

function createStreamingResponse() {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":0,"model":"openai/gpt-5","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":0,"model":"openai/gpt-5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  );
}

describe("runAgent", () => {
  const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
  const originalOpenRouterModel = process.env.OPENROUTER_MODEL;
  const originalMcpModel = process.env.MCP_MODEL;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
    delete process.env.OPENROUTER_MODEL;
    // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
    delete process.env.MCP_MODEL;
  });

  afterEach(() => {
    if (originalOpenRouterApiKey === undefined) {
      // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
    }

    if (originalOpenRouterModel === undefined) {
      // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
      delete process.env.OPENROUTER_MODEL;
    } else {
      process.env.OPENROUTER_MODEL = originalOpenRouterModel;
    }

    if (originalMcpModel === undefined) {
      // biome-ignore lint/performance/noDelete: Required to properly unset environment variable
      delete process.env.MCP_MODEL;
    } else {
      process.env.MCP_MODEL = originalMcpModel;
    }

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses OpenRouter chat completions when configured", async () => {
    let requestUrl: string | undefined;
    let authorization: string | null = null;
    let requestBody: unknown;

    vi.spyOn(console, "log").mockImplementation(() => {});

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request | URL | string, init?: RequestInit) => {
        const request =
          input instanceof Request
            ? new Request(input, init)
            : new Request(input.toString(), init);
        requestUrl = request.url;
        authorization = request.headers.get("authorization");
        requestBody = await request.json();

        return createStreamingResponse();
      }),
    );

    const connection: MCPConnection = {
      client: {
        tools: async () => ({}),
      },
      tools: new Map(),
      disconnect: async () => {},
      sessionId: "test-session",
      transport: "stdio",
    };

    await runAgent(connection, "hello", {
      provider: "openrouter",
      maxSteps: 1,
    });

    expect(requestUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(authorization).toBe("Bearer sk-or-test");
    expect(requestBody).toMatchObject({
      model: "openai/gpt-5",
      stream: true,
    });
  });
});
