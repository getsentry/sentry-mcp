import { useState, useEffect } from "react";

export type EndpointMode = "standard" | "agent";

const STORAGE_KEY = "sentry-mcp-endpoint-mode";

/**
 * Safe localStorage accessor that handles environments where localStorage
 * is null or throws (e.g. Qt WebEngine with storage disabled, cross-origin iframes).
 */
const safeLocalStorage = {
  getItem(key: string): string | null {
    try {
      if (typeof window !== "undefined" && window.localStorage != null) {
        return window.localStorage.getItem(key);
      }
    } catch {
      // SecurityError or other access errors
    }
    return null;
  },
  setItem(key: string, value: string): void {
    try {
      if (typeof window !== "undefined" && window.localStorage != null) {
        window.localStorage.setItem(key, value);
      }
    } catch {
      // SecurityError or other access errors
    }
  },
};

/**
 * Hook to manage MCP endpoint mode preference.
 * Toggles between "/mcp" (standard) and "/mcp?agent=1" (agent mode).
 *
 * The preference is persisted in localStorage.
 */
export function useEndpointMode() {
  const [endpointMode, setEndpointModeState] = useState<EndpointMode>(() => {
    // Initialize from localStorage on mount
    const stored = safeLocalStorage.getItem(STORAGE_KEY);
    if (stored === "agent" || stored === "standard") {
      return stored;
    }
    return "standard"; // Default to standard mode
  });

  // Persist to localStorage when changed
  useEffect(() => {
    safeLocalStorage.setItem(STORAGE_KEY, endpointMode);
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
