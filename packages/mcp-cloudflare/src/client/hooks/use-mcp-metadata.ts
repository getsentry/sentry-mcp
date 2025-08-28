/**
 * Custom hook to fetch and manage MCP metadata
 *
 * Provides immediate access to prompts and tools without waiting for chat stream
 * Also includes permission level information for tool access control
 */
import { useState, useEffect, useCallback } from "react";
import type { McpMetadata } from "../components/chat/types";

interface UseMcpMetadataResult {
  metadata: McpMetadata | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMcpMetadata(
  enabledWhenAuthenticated = true,
  enabledForPermissionSelection = false,
): UseMcpMetadataResult {
  const [metadata, setMetadata] = useState<McpMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMetadata = useCallback(async () => {
    if (!enabledWhenAuthenticated && !enabledForPermissionSelection) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/metadata", {
        credentials: "include", // Include cookies
      });

      // For permission selection, we might not be authenticated yet
      // In this case, we'll create a temporary token or use a different endpoint
      if (!response.ok) {
        if (enabledForPermissionSelection && response.status === 401) {
          // For permission selection, we need basic metadata without authentication
          // This could be handled with a public metadata endpoint or mock data
          // For now, we'll set basic permission info without tools
          const basicMetadata: McpMetadata = {
            type: "mcp-metadata",
            prompts: [],
            tools: [],
            toolPermissions: {},
            permissionLevels: {
              "read-only": {
                title: "Read Only",
                description:
                  "Basic information retrieval and search capabilities",
                capabilities: [
                  "View organization, team, and project information",
                  "Search and view issues, events, and traces",
                  "Access documentation and help content",
                  "Analyze issues with AI assistance",
                ],
              },
              "issue-triage": {
                title: "Issue Triage",
                description:
                  "Issue management capabilities for bug triage and resolution",
                capabilities: [
                  "All read-only capabilities",
                  "Update issue status (resolve, ignore, reopen)",
                  "Assign issues to users or teams",
                  "Manage issue lifecycle and assignments",
                ],
              },
              "project-management": {
                title: "Project Management",
                description: "Full project and team management capabilities",
                capabilities: [
                  "All issue triage capabilities",
                  "Create and manage teams",
                  "Create and configure projects",
                  "Generate and manage DSN keys",
                  "Update project settings and team assignments",
                ],
              },
            },
            timestamp: new Date().toISOString(),
          };
          setMetadata(basicMetadata);
          return;
        }

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
  }, [enabledWhenAuthenticated, enabledForPermissionSelection]);

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
