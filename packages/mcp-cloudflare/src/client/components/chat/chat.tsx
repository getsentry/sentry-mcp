"use client";

import { useChat } from "ai/react";
import { useEffect, useRef, useCallback } from "react";
import { Button } from "../ui/button";
import { AuthForm, ChatInput, ChatMessages, PanelBackdrop } from ".";
import { useAuthContext } from "../../contexts/auth-context";
import { AlertCircle, LogOut, X } from "lucide-react";

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
  } = useAuthContext();
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

      // Parse structured error response
      let statusCode: number | undefined;
      let errorName: string | undefined;
      let errorData: any = null;

      try {
        // Extract status code from error message (e.g., "Error: 401")
        const statusMatch = error.message.match(/\b(\d{3})\b/);
        if (statusMatch) {
          statusCode = Number.parseInt(statusMatch[1], 10);
        }

        // Try to parse JSON error response from message
        const jsonMatch = error.message.match(/\{.*\}/);
        if (jsonMatch) {
          errorData = JSON.parse(jsonMatch[0]);
          errorName = errorData.name;
        }
      } catch {
        // Fall back to basic status code detection if JSON parsing fails
      }

      // Handle errors based on status code and error name
      if (statusCode === 401) {
        // Authentication errors - clear auth state and force re-login
        console.error("Authentication error detected, clearing auth state", {
          statusCode,
          errorName,
        });
        clearAuthState();
      } else if (statusCode === 403) {
        // Authorization errors - user lacks permissions but auth is valid
        if (errorName === "INSUFFICIENT_PERMISSIONS") {
          console.error(
            "Authorization error detected - insufficient permissions",
            {
              statusCode,
              errorName,
            },
          );
          // Don't clear auth - user may need different org access
        }
      } else if (statusCode === 429) {
        // Rate limiting errors
        if (
          errorName === "RATE_LIMIT_EXCEEDED" ||
          errorName === "AI_RATE_LIMIT"
        ) {
          console.error("Rate limit error detected", {
            statusCode,
            errorName,
          });
          // Could show a specific rate limit message in the future
        }
      } else if (statusCode === 500) {
        // Server errors
        console.error("Server error detected", {
          statusCode,
          errorName,
          eventId: errorData?.eventId,
        });
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

  // Disable body scrolling when panel is open (mobile only)
  useEffect(() => {
    if (isOpen) {
      // Disable scrolling on mobile when chat is open
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
      <>
        {/* Mobile: Overlay layout - positioned behind when closed */}
        <div
          className={`md:hidden fixed inset-0 bg-transparent max-w-none max-h-none w-full h-full m-0 p-0 ${
            isOpen ? "z-40 pointer-events-auto" : "-z-10 pointer-events-none"
          }`}
        >
          {/* Backdrop */}
          <PanelBackdrop isOpen={isOpen} onClose={onClose} />

          {/* Auth Panel */}
          <div
            className={`fixed top-0 right-0 h-full w-full max-w-2xl bg-slate-950 border-l border-slate-800 z-50 transform shadow-2xl max-md:transition-all max-md:duration-500 max-md:ease-out ${
              isOpen
                ? "translate-x-0 opacity-100"
                : "translate-x-full opacity-90"
            }`}
          >
            {/* Floating Close Button */}
            <Button
              type="button"
              onClick={onClose}
              variant="default"
              className="absolute top-4 left-4 z-10 cursor-pointer"
              title="Close"
              aria-label="Close chat panel"
            >
              <X className="h-4 w-4" />
            </Button>

            <div className="h-full flex flex-col items-center justify-center">
              <AuthForm
                authError={authError}
                isAuthenticating={isAuthenticating}
                onOAuthLogin={handleOAuthLogin}
              />
            </div>
          </div>
        </div>

        {/* Desktop: Auth form - hidden by default, only show when open */}
        <div
          className={`${
            isOpen ? "hidden md:flex" : "hidden"
          } h-full bg-slate-950 flex-col items-center justify-center fixed top-0 right-0 w-1/2 border-l border-slate-800 md:transition-opacity md:duration-300`}
        >
          <AuthForm
            authError={authError}
            isAuthenticating={isAuthenticating}
            onOAuthLogin={handleOAuthLogin}
          />
        </div>
      </>
    );
  }

  // Show chat interface when authenticated
  return (
    <>
      {/* Mobile: Overlay layout - positioned behind when closed */}
      <div
        className={`md:hidden fixed inset-0 bg-transparent max-w-none max-h-none w-full h-full m-0 p-0 ${
          isOpen ? "z-40 pointer-events-auto" : "-z-10 pointer-events-none"
        }`}
      >
        {/* Backdrop */}
        <PanelBackdrop isOpen={isOpen} onClose={onClose} />

        {/* Chat Panel */}
        <div
          className={`fixed top-0 right-0 h-full w-full max-w-2xl bg-slate-950 border-l border-slate-800 z-50 transform shadow-2xl max-md:transition-all max-md:duration-500 max-md:ease-out ${
            isOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-90"
          }`}
          aria-labelledby="chat-panel-title"
        >
          {/* Floating Close Button */}
          <Button
            type="button"
            onClick={onClose}
            variant="default"
            className="absolute top-4 left-4 z-10 cursor-pointer"
            title="Close"
          >
            <X className="h-4 w-4" />
          </Button>

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

      {/* Desktop: Fixed positioned as right half - hidden by default, only show when open */}
      <div
        className={`${
          isOpen ? "hidden md:flex" : "hidden"
        } fixed top-0 right-0 h-screen w-1/2 bg-slate-950 flex-col border-l border-slate-800 md:transition-opacity md:duration-300`}
        aria-labelledby="chat-panel-title"
      >
        <div className="flex-1 flex flex-col min-h-0">
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
    </>
  );
}
