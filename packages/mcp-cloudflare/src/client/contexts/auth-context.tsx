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

const TOKEN_KEY = "sentry_access_token";
const POPUP_CHECK_INTERVAL = 1000;

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authToken, setAuthToken] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState("");

  // Keep refs for cleanup
  const popupRef = useRef<Window | null>(null);
  const intervalRef = useRef<number | null>(null);

  // Initialize from localStorage
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      setAuthToken(token);
      setIsAuthenticated(true);
    }
    setIsLoading(false);
  }, []);

  // Handle OAuth messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Security check
      if (event.origin !== window.location.origin) return;

      if (isOAuthSuccessMessage(event.data)) {
        const { accessToken } = event.data.data;

        // Update state
        setAuthToken(accessToken);
        setIsAuthenticated(true);
        setIsAuthenticating(false);
        setAuthError("");

        // Save to storage
        localStorage.setItem(TOKEN_KEY, accessToken);

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
    setAuthToken("");
    localStorage.removeItem(TOKEN_KEY);
  }, []);

  const clearAuthState = useCallback(() => {
    setIsAuthenticated(false);
    setAuthToken("");
    setAuthError("");
    localStorage.removeItem(TOKEN_KEY);
  }, []);

  const value: AuthContextType = {
    isLoading,
    isAuthenticated,
    authToken,
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
