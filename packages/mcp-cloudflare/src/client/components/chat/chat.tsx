"use client";

import { useChat } from "ai/react";
import { useEffect, useRef } from "react";
import { Button } from "../ui/button";
import { AuthForm, ChatUI } from ".";
import { useAuth } from "../../contexts/auth-context";
import { X, Loader2 } from "lucide-react";
import type { ChatProps } from "./types";
import { useScrollToBottom } from "../../hooks/use-scroll-to-bottom";
import { SlidingPanel } from "../ui/sliding-panel";
import { isAuthError } from "../../utils/chat-error-handler";

// We don't need user info since we're using MCP tokens
// The MCP server handles all Sentry authentication internally

export function Chat({ isOpen, onClose }: ChatProps) {
  const {
    isLoading,
    isAuthenticated,
    authToken,
    isAuthenticating,
    authError,
    handleOAuthLogin,
    handleLogout,
    clearAuthState,
  } = useAuth();

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading: isChatLoading,
    stop,
    error,
    reload,
    setMessages,
  } = useChat({
    api: "/api/chat",
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    // Use a stable ID that doesn't change during reauthentication
    // This preserves messages when the auth token changes
    id: "chat-session",
  });

  // Use declarative scroll hook - scroll on new messages and during streaming
  const { containerRef: messagesContainerRef } =
    useScrollToBottom<HTMLDivElement>({
      enabled: true,
      smooth: true,
      dependencies: [messages, isChatLoading],
      delay: isChatLoading ? 100 : 0, // More frequent updates during streaming
    });

  // Only clear messages on explicit logout, not during reauthentication
  // This is now handled in the handleLogout function

  // Track if we had an auth error before and the token when it happened
  const hadAuthErrorRef = useRef(false);
  const authTokenWhenErrorRef = useRef<string>("");
  const retriedRef = useRef(false);

  // Handle auth error detection and retry after reauthentication
  useEffect(() => {
    // If we get an auth error, record it and the current token
    if (error && isAuthError(error) && !hadAuthErrorRef.current) {
      hadAuthErrorRef.current = true;
      authTokenWhenErrorRef.current = authToken;
      retriedRef.current = false;
    }

    // If we had an auth error and the token changed (reauthentication), retry once
    if (
      hadAuthErrorRef.current &&
      authToken &&
      authToken !== authTokenWhenErrorRef.current &&
      !retriedRef.current
    ) {
      hadAuthErrorRef.current = false;
      retriedRef.current = true;
      // Retry the failed message
      reload();
    }

    // Reset retry state on successful completion (no error)
    if (!error) {
      hadAuthErrorRef.current = false;
      retriedRef.current = false;
      authTokenWhenErrorRef.current = "";
    }
  }, [authToken, error, reload]);

  // Show loading state while checking auth session
  if (isLoading) {
    return (
      <SlidingPanel isOpen={isOpen} onClose={onClose}>
        <div className="h-full flex items-center justify-center">
          <div className="animate-pulse text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </div>
      </SlidingPanel>
    );
  }

  // Use a single SlidingPanel and transition between auth and chat states
  return (
    <SlidingPanel isOpen={isOpen} onClose={onClose}>
      {/* Mobile close button - always visible */}
      <Button
        type="button"
        onClick={onClose}
        variant="default"
        className="md:hidden absolute top-4 left-4 z-10 cursor-pointer"
        title="Close"
        aria-label="Close chat panel"
      >
        <X className="h-4 w-4" />
      </Button>

      {/* Auth form with fade transition */}
      <div
        className={`absolute inset-0 h-full flex flex-col items-center justify-center transition-all duration-500 ease-in-out ${
          !isAuthenticated
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        style={{
          visibility: !isAuthenticated ? "visible" : "hidden",
          transitionProperty: "opacity, transform",
          transform: !isAuthenticated ? "scale(1)" : "scale(0.95)",
        }}
      >
        <AuthForm
          authError={authError}
          isAuthenticating={isAuthenticating}
          onOAuthLogin={handleOAuthLogin}
        />
      </div>

      {/* Chat UI with fade transition */}
      <div
        className={`absolute inset-0 transition-all duration-500 ease-in-out ${
          isAuthenticated
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        style={{
          visibility: isAuthenticated ? "visible" : "hidden",
          transitionProperty: "opacity, transform",
          transform: isAuthenticated ? "scale(1)" : "scale(1.05)",
        }}
      >
        <ChatUI
          ref={messagesContainerRef}
          messages={messages}
          input={input}
          error={error}
          isChatLoading={isChatLoading}
          isOpen={isOpen}
          showControls={true}
          onInputChange={handleInputChange}
          onSubmit={handleSubmit}
          onStop={stop}
          onRetry={reload}
          onClose={onClose}
          onLogout={() => {
            // Clear messages on explicit logout
            setMessages([]);
            handleLogout();
          }}
        />
      </div>
    </SlidingPanel>
  );
}
