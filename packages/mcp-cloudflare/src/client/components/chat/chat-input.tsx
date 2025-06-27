import { useEffect, useRef } from "react";
import { Send, CircleStop } from "lucide-react";
import { Button } from "../ui/button";

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  isOpen: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
  onSlashCommand?: (command: string) => void;
}

export function ChatInput({
  input,
  isLoading,
  isOpen,
  onInputChange,
  onSubmit,
  onStop,
  onSlashCommand,
}: ChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus when dialog opens (with delay for mobile animation)
  useEffect(() => {
    if (isOpen) {
      // Add delay to ensure the slide-in animation completes on mobile
      const timer = setTimeout(() => {
        // Use requestAnimationFrame to ensure browser has finished layout
        requestAnimationFrame(() => {
          if (inputRef.current && !inputRef.current.disabled) {
            inputRef.current.focus({ preventScroll: false });
          }
        });
      }, 600); // Delay to account for 500ms animation
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Re-focus when loading finishes
  useEffect(() => {
    if (inputRef.current && !isLoading && isOpen) {
      inputRef.current.focus();
    }
  }, [isLoading, isOpen]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Check if input is a slash command
    if (input.startsWith("/") && onSlashCommand) {
      const command = input.slice(1).toLowerCase().trim();
      // Pass all slash commands to the handler, let it decide what to do
      onSlashCommand(command);
      return;
    }

    // Otherwise, submit normally
    onSubmit(e);
  };

  return (
    <form onSubmit={handleSubmit} className="relative flex-1">
      <div className="relative">
        <input
          ref={inputRef}
          value={input}
          onChange={onInputChange}
          placeholder="Ask me anything about your Sentry data..."
          disabled={isLoading}
          className="w-full p-4 pr-12 rounded bg-slate-800/50 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-transparent disabled:opacity-50"
        />
        <Button
          type={isLoading ? "button" : "submit"}
          variant="ghost"
          onClick={isLoading ? onStop : undefined}
          disabled={!isLoading && !input.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:bg-transparent transition-colors"
          title={isLoading ? "Stop generation" : "Send message"}
        >
          {isLoading ? (
            <CircleStop className="h-4 w-4" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </form>
  );
}
