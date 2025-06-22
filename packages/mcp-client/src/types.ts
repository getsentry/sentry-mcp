// Shared types for MCP client

export interface MCPConnection {
  client: any; // TODO: Replace with proper type from experimental MCP client
  tools: Map<string, any>;
  disconnect: () => Promise<void>;
}

export interface MCPConfig {
  accessToken: string;
  host?: string;
}

export interface RemoteMCPConfig {
  mcpHost?: string;
  accessToken?: string;
}
