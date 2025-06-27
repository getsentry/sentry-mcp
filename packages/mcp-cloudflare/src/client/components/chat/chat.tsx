"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useCallback } from "react";
import { Button } from "../ui/button";
import { AuthForm, ChatUI } from ".";
import { useAuth } from "../../contexts/auth-context";
import { X, Loader2 } from "lucide-react";
import type { ChatProps } from "./types";
import { useScrollToBottom } from "../../hooks/use-scroll-to-bottom";
import { usePersistedChat } from "../../hooks/use-persisted-chat";
import { SlidingPanel } from "../ui/sliding-panel";
import { isAuthError } from "../../utils/chat-error-handler";

// We don't need user info since we're using MCP tokens
// The MCP server handles all Sentry authentication internally

export function Chat({ isOpen, onClose, onLogout }: ChatProps) {
  const {
    isLoading,
    isAuthenticated,
    authToken,
    isAuthenticating,
    authError,
    handleOAuthLogin,
  } = useAuth();

  // Use persisted chat to save/load messages from localStorage
  const { initialMessages, saveMessages, clearPersistedMessages } =
    usePersistedChat(isAuthenticated);

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    stop,
    error,
    reload,
    setMessages,
    setInput,
    append,
  } = useChat({
    api: "/api/chat",
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    // No ID to disable useChat's built-in persistence
    // We handle persistence manually via usePersistedChat hook
    initialMessages,
  });

  // Use declarative scroll hook - scroll on new messages and during streaming
  const { containerRef: messagesContainerRef } =
    useScrollToBottom<HTMLDivElement>({
      enabled: true,
      smooth: true,
      dependencies: [messages, status],
      delay: status === "streaming" || status === "submitted" ? 100 : 0, // More frequent updates during loading
    });

  // Clear messages function - used locally for /clear command and logout
  const clearMessages = useCallback(() => {
    setMessages([]);
    clearPersistedMessages();
  }, [setMessages, clearPersistedMessages]);

  // Track previous auth state to detect logout events
  const prevAuthStateRef = useRef({ isAuthenticated, authToken });

  // Clear messages when user logs out (auth state changes from authenticated to not)
  useEffect(() => {
    const prevState = prevAuthStateRef.current;
    const wasAuthenticated = prevState.isAuthenticated;

    // Detect logout: was authenticated but now isn't
    if (wasAuthenticated && !isAuthenticated) {
      clearMessages();
    }

    // Update the ref for next comparison
    prevAuthStateRef.current = { isAuthenticated, authToken };
  }, [isAuthenticated, authToken, clearMessages]);

  // Save messages when they change
  useEffect(() => {
    saveMessages(messages);
  }, [messages, saveMessages]);

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

  // Handle sending a prompt programmatically
  const handleSendPrompt = useCallback(
    (prompt: string) => {
      // Clear the input and directly send the message using append
      append({ role: "user", content: prompt });
    },
    [append],
  );

  // Handle slash commands
  const handleSlashCommand = (command: string) => {
    // Always clear the input first for all commands
    setInput("");

    // Add the slash command as a user message first
    const userMessage = {
      id: Date.now().toString(),
      role: "user" as const,
      content: `/${command}`,
      createdAt: new Date(),
    };

    if (command === "clear") {
      // Clear everything
      clearMessages();
    } else if (command === "logout") {
      // Add message, then logout
      setMessages((prev: any[]) => [...prev, userMessage]);
      onLogout();
    } else {
      // Handle unknown slash commands - add user message and error
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        role: "system" as const,
        content: `Unknown command: /${command}. Available commands: /clear, /logout`,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, userMessage, errorMessage]);
    }
  };

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
          isChatLoading={status === "streaming" || status === "submitted"}
          isOpen={isOpen}
          showControls
          onInputChange={handleInputChange}
          onSubmit={handleSubmit}
          onStop={stop}
          onRetry={reload}
          onClose={onClose}
          onLogout={onLogout}
          onSlashCommand={handleSlashCommand}
          onSendPrompt={handleSendPrompt}
        />
      </div>
    </SlidingPanel>
  );
}
