import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { AuthContextType } from "../components/chat/types";
import {
  isOAuthSuccessMessage,
  isOAuthErrorMessage,
} from "../components/chat/types";

// No interval-based polling required; popup communicates via postMessage/storage

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState("");

  // Popup reference
  const popupRef = useRef<Window | null>(null);

  // Check if authenticated by making a request to the server
  useEffect(() => {
    // Check authentication status
    fetch("/api/auth/status", { credentials: "include" })
      .then((res) => res.ok)
      .then((authenticated) => {
        setIsAuthenticated(authenticated);
        setIsLoading(false);
      })
      .catch(() => {
        setIsAuthenticated(false);
        setIsLoading(false);
      });
  }, []);

  // Process OAuth result from localStorage
  const processOAuthResult = useCallback((data: unknown) => {
    if (isOAuthSuccessMessage(data)) {
      // Verify session on server before marking authenticated
      fetch("/api/auth/status", { credentials: "include" })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({}) as unknown);
            throw new Error(
              typeof body === "object" &&
                body &&
                "error" in (body as Record<string, unknown>)
                ? String((body as Record<string, unknown>).error)
                : "Authentication not yet completed",
            );
          }
          // Fully reload the app to pick up new auth context/cookies
          // This avoids intermediate/loading states and ensures a clean session
          window.location.reload();
        })
        .catch(() => {
          setIsAuthenticated(false);
          setAuthError("Authentication not completed. Please finish sign-in.");
        })
        .finally(() => {
          setIsAuthenticating(false);
          // Cleanup popup reference
          if (popupRef.current) {
            popupRef.current = null;
          }
        });
    } else if (isOAuthErrorMessage(data)) {
      setAuthError(data.error || "Authentication failed");
      setIsAuthenticating(false);

      // Cleanup popup reference
      if (popupRef.current) {
        popupRef.current = null;
      }
    }
  }, []);

  // Listen for storage events from the popup to process results immediately
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "oauth_result") return;
      try {
        const raw = e.newValue;
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        // Clear after reading
        localStorage.removeItem("oauth_result");
        processOAuthResult(parsed);
      } catch {
        // ignore parse errors
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [processOAuthResult]);

  // Listen for postMessage from the popup for immediate result delivery
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only accept messages from same origin for safety
      if (e.origin !== window.location.origin) return;
      const data = e.data as unknown;
      if (isOAuthSuccessMessage(data) || isOAuthErrorMessage(data)) {
        processOAuthResult(data);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [processOAuthResult]);

  // No interval cleanup needed

  const handleOAuthLogin = useCallback(() => {
    setAuthError("");

    const desiredWidth = Math.max(Math.min(window.screen.availWidth, 900), 600);
    const desiredHeight = Math.min(window.screen.availHeight, 900);
    const windowFeatures = `width=${desiredWidth},height=${desiredHeight},resizable=yes,scrollbars=yes`;

    // Clear any stale results from previous attempts before starting
    try {
      localStorage.removeItem("oauth_result");
    } catch {
      // ignore storage errors
    }

    // If a popup is already open, focus it instead of opening another
    if (popupRef.current && !popupRef.current.closed) {
      try {
        popupRef.current.focus();
      } catch {
        // ignore focus errors
      }
      return;
    }

    const popup = window.open("/api/auth/authorize", "oauth", windowFeatures);

    if (!popup) {
      setAuthError("Popup blocked. Please allow popups and try again.");
      return;
    }

    popupRef.current = popup;
  }, []);

  // No explicit check/cancel actions required in current UX

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore errors, proceed with local logout
    }

    setIsAuthenticated(false);
  }, []);

  const clearAuthState = useCallback(() => {
    setIsAuthenticated(false);
    setAuthError("");
  }, []);

  const value: AuthContextType = {
    isLoading,
    isAuthenticated,
    authToken: "", // Keep for backward compatibility
    isAuthenticating,
    authError,
    handleOAuthLogin,
    handleLogout,
    clearAuthState,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
