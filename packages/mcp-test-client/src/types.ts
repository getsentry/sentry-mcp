// Shared types for MCP client

export interface MCPConnection {
  client: any; // TODO: Replace with proper type from experimental MCP client
  tools: Map<string, any>;
  disconnect: () => Promise<void>;
  sessionId: string;
  transport: "stdio" | "http";
}

export interface MCPConfig {
  accessToken: string;
  host?: string;
  sentryDsn?: string;
  useAgentEndpoint?: boolean;
  useExperimental?: boolean;
}

export interface RemoteMCPConfig {
  mcpHost?: string;
  accessToken?: string;
  useAgentEndpoint?: boolean;
  useExperimental?: boolean;
}
