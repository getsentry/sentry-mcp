/**
 * Reusable chat UI component
 * Extracts the common chat interface used in both mobile and desktop views
 */

import { forwardRef } from "react";
import { LogOut, X } from "lucide-react";
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
  onSlashCommand?: (command: string) => void;
  onSendPrompt?: (prompt: string) => void;
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
      onSlashCommand,
      onSendPrompt,
    },
    ref,
  ) => {
    return (
      <div className="h-full flex flex-col">
        {/* Mobile header with close and logout buttons */}
        <div className="md:hidden flex items-center justify-between p-4 border-b border-slate-800 flex-shrink-0">
          {showControls && (
            <>
              <Button type="button" onClick={onClose} size="icon" title="Close">
                <X className="h-4 w-4" />
              </Button>

              <Button
                type="button"
                onClick={onLogout}
                size="icon"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>

        <div className="pb-34 overflow-y-auto">
          {/* Chat Messages */}
          <ChatMessages
            ref={ref}
            messages={messages}
            isChatLoading={isChatLoading}
            error={error}
            onRetry={onRetry}
          />

          {/* Chat Input - Always pinned at bottom */}
          <div className="py-4 px-6 bottom-0 left-0 right-0 absolute bg-slate-950/95 h-34 overflow-hidden">
            {/* Sample Prompt Buttons - Always visible above input */}
            {onSendPrompt && (
              <div className="mb-4 flex flex-wrap gap-2 justify-center">
                <Button
                  type="button"
                  onClick={() =>
                    onSendPrompt("What organizations do I have access to?")
                  }
                  size="sm"
                  variant="outline"
                >
                  Get Organizations
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    onSendPrompt(
                      "Show me how to set up the React SDK for error monitoring",
                    )
                  }
                  size="sm"
                  variant="outline"
                >
                  React SDK Usage
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    onSendPrompt("What are my most recent issues?")
                  }
                  size="sm"
                  variant="outline"
                >
                  Recent Issues
                </Button>
              </div>
            )}

            <ChatInput
              input={input}
              isLoading={isChatLoading}
              isOpen={isOpen}
              onInputChange={onInputChange}
              onSubmit={onSubmit}
              onStop={onStop || EMPTY_FUNCTION}
              onSlashCommand={onSlashCommand}
            />
          </div>
        </div>
      </div>
    );
  },
);

ChatUI.displayName = "ChatUI";
