import { useState, useEffect, useRef } from "react";

export interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  authToken: string;
  isAuthenticating: boolean;
  authError: string;
}

export interface AuthActions {
  handleOAuthLogin: () => void;
  handleLogout: () => void;
  clearAuthState: () => void;
}

export function useAuth(): AuthState & AuthActions {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authToken, setAuthToken] = useState<string>("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string>("");
  const popupCheckIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    // Check for existing token in localStorage
    const checkAuthSession = async () => {
      try {
        const savedToken = localStorage.getItem("sentry_access_token");

        if (savedToken) {
          setAuthToken(savedToken);
          setIsAuthenticated(true);
        }
      } catch (error) {
        console.error("Error checking auth session:", error);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuthSession();

    // Listen for OAuth popup messages
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === "SENTRY_AUTH_SUCCESS") {
        const { accessToken } = event.data.data;

        // Clear the popup check interval
        if (popupCheckIntervalRef.current) {
          clearInterval(popupCheckIntervalRef.current);
          popupCheckIntervalRef.current = null;
        }

        setAuthToken(accessToken);
        setIsAuthenticated(true);
        setIsAuthenticating(false);
        setAuthError("");

        // Store in localStorage
        localStorage.setItem("sentry_access_token", accessToken);
      } else if (event.data.type === "SENTRY_AUTH_ERROR") {
        // Clear the popup check interval
        if (popupCheckIntervalRef.current) {
          clearInterval(popupCheckIntervalRef.current);
          popupCheckIntervalRef.current = null;
        }

        setAuthError(event.data.error || "Authentication failed");
        setIsAuthenticating(false);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Cleanup popup check interval on unmount
  useEffect(() => {
    return () => {
      if (popupCheckIntervalRef.current) {
        clearInterval(popupCheckIntervalRef.current);
        popupCheckIntervalRef.current = null;
      }
    };
  }, []);

  const handleOAuthLogin = () => {
    setIsAuthenticating(true);
    setAuthError("");

    // Open OAuth popup
    const popup = window.open(
      "/api/auth/authorize",
      "sentry-oauth",
      "width=600,height=700,scrollbars=yes,resizable=yes",
    );

    // Check if popup was blocked
    if (!popup) {
      setAuthError("Popup blocked. Please allow popups and try again.");
      setIsAuthenticating(false);
      return;
    }

    // Monitor popup for closure (user cancellation)
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        popupCheckIntervalRef.current = null;
        if (isAuthenticating) {
          setIsAuthenticating(false);
          setAuthError("Authentication was cancelled.");
        }
      }
    }, 1000);

    // Store interval ID for cleanup
    popupCheckIntervalRef.current = checkClosed;
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (error) {
      // Ignore logout errors
    }

    setIsAuthenticated(false);
    setAuthToken("");
    localStorage.removeItem("sentry_access_token");
  };

  const clearAuthState = () => {
    setIsAuthenticated(false);
    setAuthToken("");
    localStorage.removeItem("sentry_access_token");
  };

  return {
    isLoading,
    isAuthenticated,
    authToken,
    isAuthenticating,
    authError,
    handleOAuthLogin,
    handleLogout,
    clearAuthState,
  };
}
