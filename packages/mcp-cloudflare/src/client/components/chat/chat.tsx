"use client";

import { useChat } from "ai/react";
import { useEffect, useRef, useCallback } from "react";
import { Button } from "../ui/button";
import { AuthForm, ChatInput, ChatMessages, PanelBackdrop, useAuth } from ".";
import { AlertCircle, LogOut } from "lucide-react";

interface ChatProps {
  isOpen: boolean;
  onClose: () => void;
}

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    // Scroll to the bottom of the messages container
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight;
    }
  }, []);

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading: isChatLoading,
    stop,
    error,
    reload,
  } = useChat({
    api: "/api/chat",
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    onError: (error: Error) => {
      console.error("Chat error:", error);

      // Handle authentication and authorization errors
      if (
        error.message.includes("401") ||
        error.message.includes("Authorization") ||
        error.message.includes("AUTH_EXPIRED") ||
        error.message.includes("Authentication with Sentry has expired")
      ) {
        console.log("Authentication expired, clearing auth state");
        clearAuthState();
      } else if (
        error.message.includes("403") ||
        error.message.includes("INSUFFICIENT_PERMISSIONS") ||
        error.message.includes("permission")
      ) {
        console.log("Insufficient permissions detected");
        // For permission errors, we don't clear auth but log the issue
        // The user might need to switch organizations or get access
      }
    },
  });

  // Auto-scroll when messages change
  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  // Auto-scroll during streaming (more frequently)
  useEffect(() => {
    if (isChatLoading) {
      const interval = setInterval(() => {
        scrollToBottom();
      }, 100);
      return () => clearInterval(interval);
    }
  }, [isChatLoading, scrollToBottom]);

  // Disable body scrolling when panel is open
  useEffect(() => {
    if (isOpen) {
      // Disable scrolling
      document.body.style.overflow = "hidden";
    } else {
      // Restore scrolling
      document.body.style.overflow = "";
    }

    // Cleanup function to restore scrolling when component unmounts
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Show loading state while checking auth session
  if (isLoading) {
    return null;
  }

  // Show authentication form if not authenticated
  if (!isAuthenticated) {
    return (
      <div
        className={`fixed inset-0 z-40 bg-transparent max-w-none max-h-none w-full h-full m-0 p-0 ${
          isOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        {/* Backdrop */}
        <PanelBackdrop isOpen={isOpen} onClose={onClose} />

        {/* Auth Panel */}
        <div
          className={`fixed top-0 right-0 h-full w-full max-w-2xl bg-slate-950 border-l border-slate-800 z-50 transform transition-all duration-500 ease-out shadow-2xl ${
            isOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-90"
          }`}
        >
          <div className="h-full flex flex-col">
            <AuthForm
              authError={authError}
              isAuthenticating={isAuthenticating}
              onOAuthLogin={handleOAuthLogin}
            />
          </div>
        </div>
      </div>
    );
  }

  // Show chat interface when authenticated
  return (
    <div
      className={`fixed inset-0 z-40 bg-transparent max-w-none max-h-none w-full h-full m-0 p-0 ${
        isOpen ? "pointer-events-auto" : "pointer-events-none"
      }`}
    >
      {/* Backdrop */}
      <PanelBackdrop isOpen={isOpen} onClose={onClose} />

      {/* Chat Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-2xl bg-slate-950 border-l border-slate-800 z-50 transform transition-all duration-500 ease-out shadow-2xl ${
          isOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-90"
        }`}
        aria-labelledby="chat-panel-title"
      >
        {/* Floating Logout Button */}
        <Button
          type="button"
          onClick={handleLogout}
          variant="default"
          className="absolute top-4 right-4 z-10 cursor-pointer"
          title="Logout"
        >
          <LogOut className="h-4 w-4" />
        </Button>

        <div className="h-full flex flex-col">
          {/* Error Display */}
          {error && (
            <div className="flex-shrink-0 m-6 p-4 bg-red-900/20 border border-red-500/30 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400" />
              <div className="text-red-400">
                Something went wrong. Please try again.
              </div>
              <Button
                variant="link"
                size="sm"
                onClick={() => reload()}
                className="text-red-300 hover:text-red-200 ml-auto"
              >
                Retry
              </Button>
            </div>
          )}

          {/* Chat Messages */}
          <ChatMessages
            ref={messagesContainerRef}
            messages={messages}
            isChatLoading={isChatLoading}
          />
          <div ref={messagesEndRef} />

          {/* Chat Input - Always pinned at bottom */}
          <div className="flex-shrink-0 p-6">
            <ChatInput
              input={input}
              isLoading={isChatLoading}
              isOpen={isOpen}
              onInputChange={handleInputChange}
              onSubmit={handleSubmit}
              onStop={stop}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
