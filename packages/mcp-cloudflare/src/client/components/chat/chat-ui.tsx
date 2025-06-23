/**
 * Reusable chat UI component
 * Extracts the common chat interface used in both mobile and desktop views
 */

import { forwardRef } from "react";
import { AlertCircle, LogOut, X } from "lucide-react";
import { Button } from "../ui/button";
import { ChatInput, ChatMessages } from ".";
import type { Message } from "ai/react";

// Constant empty function to avoid creating new instances on every render
const EMPTY_FUNCTION = () => {};

interface ChatUIProps {
  messages: Message[];
  input: string;
  error?: Error | null;
  isChatLoading: boolean;
  isOpen?: boolean;
  showControls?: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onStop?: () => void;
  onRetry?: () => void;
  onClose?: () => void;
  onLogout?: () => void;
}

export const ChatUI = forwardRef<HTMLDivElement, ChatUIProps>(
  (
    {
      messages,
      input,
      error,
      isChatLoading,
      isOpen = true,
      showControls = false,
      onInputChange,
      onSubmit,
      onStop,
      onRetry,
      onClose,
      onLogout,
    },
    ref,
  ) => {
    return (
      <div className="h-full flex flex-col">
        {/* Mobile header with close and logout buttons */}
        <div className="md:hidden flex items-center justify-between p-4 border-b border-slate-800 flex-shrink-0">
          {showControls && (
            <>
              <Button
                type="button"
                onClick={onClose}
                variant="ghost"
                size="icon"
                className="cursor-pointer"
                title="Close"
              >
                <X className="h-4 w-4" />
              </Button>

              <Button
                type="button"
                onClick={onLogout}
                variant="ghost"
                size="icon"
                className="cursor-pointer"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          {/* Error Display */}
          {error && (
            <div className="flex-shrink-0 m-6 p-4 bg-red-900/20 border border-red-500/30 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400" />
              <div className="text-red-400">
                Something went wrong. Please try again.
              </div>
              {onRetry && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={onRetry}
                  className="text-red-300 hover:text-red-200 ml-auto"
                >
                  Retry
                </Button>
              )}
            </div>
          )}

          {/* Chat Messages */}
          <ChatMessages
            ref={ref}
            messages={messages}
            isChatLoading={isChatLoading}
          />

          {/* Chat Input - Always pinned at bottom */}
          <div
            className="flex-shrink-0 p-6"
            style={{
              paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
            }}
          >
            <ChatInput
              input={input}
              isLoading={isChatLoading}
              isOpen={isOpen}
              onInputChange={onInputChange}
              onSubmit={onSubmit}
            />
          </div>
        </div>
      </div>
    );
  },
);

ChatUI.displayName = "ChatUI";
