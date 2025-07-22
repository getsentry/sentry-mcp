import React, {
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

const POPUP_CHECK_INTERVAL = 1000;

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState("");

  // Keep refs for cleanup
  const popupRef = useRef<Window | null>(null);
  const intervalRef = useRef<number | null>(null);

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

  // Handle OAuth messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Security check
      if (event.origin !== window.location.origin) return;

      if (isOAuthSuccessMessage(event.data)) {
        // Auth succeeded - cookies were set server-side
        setIsAuthenticated(true);
        setIsAuthenticating(false);
        setAuthError("");

        // Cleanup
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        popupRef.current = null;
      } else if (isOAuthErrorMessage(event.data)) {
        setAuthError(event.data.error || "Authentication failed");
        setIsAuthenticating(false);

        // Cleanup
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        popupRef.current = null;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const handleOAuthLogin = useCallback(() => {
    setIsAuthenticating(true);
    setAuthError("");

    const popup = window.open(
      "/api/auth/authorize",
      "sentry-oauth",
      "width=600,height=700,scrollbars=yes,resizable=yes",
    );

    if (!popup) {
      setAuthError("Popup blocked. Please allow popups and try again.");
      setIsAuthenticating(false);
      return;
    }

    popupRef.current = popup;

    // Check if popup is closed by user
    intervalRef.current = window.setInterval(() => {
      if (popup.closed) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }

        // Only update state if still authenticating (no success/error received)
        setIsAuthenticating((current) => {
          if (current) {
            setAuthError("Authentication was cancelled.");
            return false;
          }
          return current;
        });

        popupRef.current = null;
      }
    }, POPUP_CHECK_INTERVAL);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
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
