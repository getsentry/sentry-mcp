import { useEffect, useRef } from "react";

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  isOpen: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
}

export function ChatInput({
  input,
  isLoading,
  isOpen,
  onInputChange,
  onSubmit,
  onStop,
}: ChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus when dialog opens (with slight delay for animation)
  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Add a small delay to ensure the dialog animation completes
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Re-focus when loading finishes
  useEffect(() => {
    if (inputRef.current && !isLoading && isOpen) {
      inputRef.current.focus();
    }
  }, [isLoading, isOpen]);

  return (
    <form onSubmit={onSubmit} className="relative flex-1">
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
