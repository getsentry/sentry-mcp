import { useState, useEffect } from "react";

export type EndpointMode = "standard" | "agent";

const STORAGE_KEY = "sentry-mcp-endpoint-mode";

/**
 * Hook to manage MCP endpoint mode preference.
 * Toggles between "/mcp" (standard) and "/mcp?agent=1" (agent mode).
 *
 * The preference is persisted in localStorage.
 */
export function useEndpointMode() {
  const [endpointMode, setEndpointModeState] = useState<EndpointMode>(() => {
    // Initialize from localStorage on mount
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "agent" || stored === "standard") {
        return stored;
      }
    }
    return "standard"; // Default to standard mode
  });

  // Persist to localStorage when changed
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, endpointMode);
    }
  }, [endpointMode]);

  const setEndpointMode = (mode: EndpointMode) => {
    setEndpointModeState(mode);
  };

  const toggleEndpointMode = () => {
    setEndpointModeState((prev) =>
      prev === "standard" ? "agent" : "standard",
    );
  };

  return {
    endpointMode,
    setEndpointMode,
    toggleEndpointMode,
    isAgentMode: endpointMode === "agent",
  };
}
