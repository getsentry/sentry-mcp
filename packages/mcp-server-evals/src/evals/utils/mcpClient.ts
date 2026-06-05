import { experimental_createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import toolDefinitions from "@sentry/mcp-core/toolDefinitions";

type MockMcpClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;

let cachedToolDescriptions: Promise<string[]> | null = null;

function createMockTransport() {
  return new Experimental_StdioMCPTransport({
    command: "pnpm",
    args: ["--filter", "@sentry/mcp-server-evals", "start"],
    env: {
      ...process.env,
      SENTRY_ACCESS_TOKEN: "mocked-access-token",
      SENTRY_HOST: "sentry.io",
    },
  });
}

function getShortDescription(description: string): string {
  return description.split("\n")[0] ?? "";
}

export async function withMockMcpClient<T>(
  callback: (client: MockMcpClient) => Promise<T>,
): Promise<T> {
  const client = await experimental_createMCPClient({
    transport: createMockTransport(),
  });

  try {
    return await callback(client);
  } finally {
    await client.close();
  }
}

async function loadAvailableToolDescriptions() {
  return toolDefinitions.map(
    (tool) => `${tool.name} - ${getShortDescription(tool.description)}`,
  );
}

export async function getAvailableToolDescriptions(): Promise<string[]> {
  cachedToolDescriptions ??= loadAvailableToolDescriptions().catch(
    (error: unknown) => {
      cachedToolDescriptions = null;
      throw error;
    },
  );

  return cachedToolDescriptions;
}
