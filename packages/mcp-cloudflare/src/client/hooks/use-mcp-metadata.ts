/**
 * Custom hook to fetch and manage MCP metadata
 *
 * Provides immediate access to prompts and tools without waiting for chat stream
 */
import { useState, useEffect, useCallback } from "react";

export interface McpMetadata {
  type: "mcp-metadata";
  prompts: Array<{
    name: string;
    description: string;
    parameters: Record<
      string,
      {
        type: string;
        required: boolean;
        description?: string;
      }
    >;
  }>;
  tools: string[];
  timestamp: string;
}

interface UseMcpMetadataResult {
  metadata: McpMetadata | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMcpMetadata(
  authToken: string | null,
  enabled = true,
): UseMcpMetadataResult {
  const [metadata, setMetadata] = useState<McpMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMetadata = useCallback(async () => {
    if (!authToken || !enabled) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/metadata", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setMetadata(data);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to fetch metadata";
      setError(errorMessage);
      console.error("Failed to fetch MCP metadata:", err);
    } finally {
      setIsLoading(false);
    }
  }, [authToken, enabled]);

  // Fetch metadata when auth token changes or component mounts
  useEffect(() => {
    fetchMetadata();
  }, [fetchMetadata]);

  return {
    metadata,
    isLoading,
    error,
    refetch: fetchMetadata,
  };
}
