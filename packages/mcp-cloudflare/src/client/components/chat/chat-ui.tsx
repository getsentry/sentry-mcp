/**
 * Reusable chat UI component
 * Extracts the common chat interface used in both mobile and desktop views
 */

import { LogOut, X } from "lucide-react";
import ScrollToBottom from "react-scroll-to-bottom";
import { Button } from "../ui/button";
import { ChatInput, ChatMessages } from ".";
import type { Message } from "ai/react";

// Constant empty function to avoid creating new instances on every render
const EMPTY_FUNCTION = () => {};

// Sample prompts for quick access
const SAMPLE_PROMPTS = [
  {
    label: "Help",
    prompt: "/help",
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
  isLocalStreaming?: boolean;
  isMessageStreaming?: (messageId: string) => boolean;
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

export const ChatUI = ({
  messages,
  input,
  error,
  isChatLoading,
  isLocalStreaming,
  isMessageStreaming,
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
}: ChatUIProps) => {
  return (
    <div className="h-full flex flex-col">
      {/* Mobile header with close and logout buttons */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-slate-800 flex-shrink-0">
        {showControls && (
          <>
            <Button type="button" onClick={onClose} size="icon" title="Close">
              <X className="h-4 w-4" />
            </Button>

            <Button type="button" onClick={onLogout} size="icon" title="Logout">
              <LogOut className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* Chat Messages - Scrollable area */}
      <ScrollToBottom
        className="flex-1 mb-34 flex overflow-y-auto"
        scrollViewClassName="px-0"
        followButtonClassName="hidden"
        initialScrollBehavior="smooth"
      >
        <ChatMessages
          messages={messages}
          isChatLoading={isChatLoading}
          isLocalStreaming={isLocalStreaming}
          isMessageStreaming={isMessageStreaming}
          error={error}
          onRetry={onRetry}
          onSlashCommand={onSlashCommand}
        />
      </ScrollToBottom>

      {/* Chat Input - Always pinned at bottom */}
      <div className="py-4 px-6 bottom-0 left-0 right-0 absolute bg-slate-950/95 h-34 overflow-hidden z-10">
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
};
