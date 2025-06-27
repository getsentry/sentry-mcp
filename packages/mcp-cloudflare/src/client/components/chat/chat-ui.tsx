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

// Sample prompts for quick access
const SAMPLE_PROMPTS = [
  {
    label: "Get Organizations",
    prompt: "What organizations do I have access to?",
  },
  {
    label: "React SDK Usage",
    prompt: "Show me how to set up the React SDK for error monitoring",
  },
  {
    label: "Recent Issues",
    prompt: "What are my most recent issues?",
  },
] as const;

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

        {/* Chat Messages - Scrollable area */}
        <div ref={ref} className="flex-1 overflow-y-auto mb-34 flex">
          <ChatMessages
            messages={messages}
            isChatLoading={isChatLoading}
            error={error}
            onRetry={onRetry}
          />
        </div>

        {/* Chat Input - Always pinned at bottom */}
        <div className="py-4 px-6 bottom-0 left-0 right-0 absolute bg-slate-950/95 h-34 overflow-hidden">
          {/* Sample Prompt Buttons - Always visible above input */}
          {onSendPrompt && (
            <div className="mb-4 flex flex-wrap gap-2 justify-center">
              {SAMPLE_PROMPTS.map((samplePrompt) => (
                <Button
                  key={samplePrompt.label}
                  type="button"
                  onClick={() => onSendPrompt(samplePrompt.prompt)}
                  size="sm"
                  variant="outline"
                >
                  {samplePrompt.label}
                </Button>
              ))}
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
    );
  },
);

ChatUI.displayName = "ChatUI";
