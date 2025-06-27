import { useEffect, useCallback, useMemo } from "react";
import type { Message } from "ai";

const CHAT_STORAGE_KEY = "sentry_chat_messages";
const MAX_STORED_MESSAGES = 100; // Limit storage size

export function usePersistedChat(isAuthenticated: boolean) {
  // Load initial messages from localStorage
  const initialMessages = useMemo(() => {
    if (!isAuthenticated) return [];

    try {
      const stored = localStorage.getItem(CHAT_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Message[];
        // Validate the data structure
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Filter out any in-progress messages that might have been interrupted
          const validMessages = parsed.filter((msg) => {
            // Check if message has parts (newer structure)
            if (msg.parts && Array.isArray(msg.parts)) {
              return msg.parts.length > 0;
            }

            // Check if message has content (legacy structure)
            if (msg.content && typeof msg.content === "string") {
              return msg.content.trim() !== "";
            }

            return false;
          });
          if (validMessages.length > 0) {
            return validMessages;
          }
        }
      }
    } catch (error) {
      console.error("Failed to load chat history:", error);
      // Clear corrupted data
      localStorage.removeItem(CHAT_STORAGE_KEY);
    }

    return [];
  }, [isAuthenticated]);

  // Function to save messages
  const saveMessages = useCallback(
    (messages: Message[]) => {
      if (!isAuthenticated || messages.length === 0) return;

      try {
        // Only store the most recent messages to avoid storage limits
        const messagesToStore = messages.slice(-MAX_STORED_MESSAGES);
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messagesToStore));
      } catch (error) {
        console.error("Failed to save chat history:", error);
        // If we hit storage quota, try to clear old messages
        if (
          error instanceof DOMException &&
          error.name === "QuotaExceededError"
        ) {
          try {
            const recentMessages = messages.slice(-50); // Keep only last 50
            localStorage.setItem(
              CHAT_STORAGE_KEY,
              JSON.stringify(recentMessages),
            );
          } catch {
            // If still failing, clear the storage
            localStorage.removeItem(CHAT_STORAGE_KEY);
          }
        }
      }
    },
    [isAuthenticated],
  );

  // Clear persisted messages
  const clearPersistedMessages = useCallback(() => {
    localStorage.removeItem(CHAT_STORAGE_KEY);
  }, []);

  return {
    initialMessages,
    saveMessages,
    clearPersistedMessages,
  };
}
