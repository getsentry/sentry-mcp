import { useEffect, useCallback, useMemo } from "react";
import type { Message } from "ai";

const CHAT_STORAGE_KEY = "sentry_chat_messages";
const TIMESTAMP_STORAGE_KEY = "sentry_chat_timestamp";
const MAX_STORED_MESSAGES = 100; // Limit storage size
const CACHE_EXPIRY_MS = 60 * 60 * 1000; // 1 hour in milliseconds

export function usePersistedChat(isAuthenticated: boolean) {
  // Check if cache is expired
  const isCacheExpired = useCallback(() => {
    try {
      const timestampStr = localStorage.getItem(TIMESTAMP_STORAGE_KEY);
      if (!timestampStr) return true;

      const timestamp = Number.parseInt(timestampStr, 10);
      const now = Date.now();
      return now - timestamp > CACHE_EXPIRY_MS;
    } catch {
      return true;
    }
  }, []);

  // Update timestamp to extend cache expiry
  const updateTimestamp = useCallback(() => {
    try {
      localStorage.setItem(TIMESTAMP_STORAGE_KEY, Date.now().toString());
    } catch (error) {
      console.error("Failed to update chat timestamp:", error);
    }
  }, []);

  // Load initial messages from localStorage
  const initialMessages = useMemo(() => {
    if (!isAuthenticated) return [];

    // Check if cache is expired
    if (isCacheExpired()) {
      // Clear expired data
      localStorage.removeItem(CHAT_STORAGE_KEY);
      localStorage.removeItem(TIMESTAMP_STORAGE_KEY);
      return [];
    }

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
            // Update timestamp since we're loading existing messages
            updateTimestamp();
            return validMessages;
          }
        }
      }
    } catch (error) {
      console.error("Failed to load chat history:", error);
      // Clear corrupted data
      localStorage.removeItem(CHAT_STORAGE_KEY);
      localStorage.removeItem(TIMESTAMP_STORAGE_KEY);
    }

    return [];
  }, [isAuthenticated, isCacheExpired, updateTimestamp]);

  // Function to save messages
  const saveMessages = useCallback(
    (messages: Message[]) => {
      if (!isAuthenticated || messages.length === 0) return;

      try {
        // Only store the most recent messages to avoid storage limits
        const messagesToStore = messages.slice(-MAX_STORED_MESSAGES);
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messagesToStore));
        // Update timestamp when saving messages (extends expiry)
        updateTimestamp();
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
            updateTimestamp();
          } catch {
            // If still failing, clear the storage
            localStorage.removeItem(CHAT_STORAGE_KEY);
            localStorage.removeItem(TIMESTAMP_STORAGE_KEY);
          }
        }
      }
    },
    [isAuthenticated, updateTimestamp],
  );

  // Clear persisted messages
  const clearPersistedMessages = useCallback(() => {
    localStorage.removeItem(CHAT_STORAGE_KEY);
    localStorage.removeItem(TIMESTAMP_STORAGE_KEY);
  }, []);

  return {
    initialMessages,
    saveMessages,
    clearPersistedMessages,
  };
}
