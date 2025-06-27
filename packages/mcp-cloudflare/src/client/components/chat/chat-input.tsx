import { useEffect, useRef } from "react";

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  isOpen: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onSlashCommand?: (command: string) => void;
}

export function ChatInput({
  input,
  isLoading,
  isOpen,
  onInputChange,
  onSubmit,
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
      <div className="flex space-x-2 items-center">
        <input
          ref={inputRef}
          value={input}
          onChange={onInputChange}
          placeholder="Ask me anything about your Sentry data..."
          disabled={isLoading}
          className="flex-1 p-4 bg-slate-800/50 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-transparent disabled:opacity-50"
        />
      </div>
    </form>
  );
}
