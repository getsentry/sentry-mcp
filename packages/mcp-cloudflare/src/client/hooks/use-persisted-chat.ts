import { useCallback, useMemo } from "react";
import type { UIMessage } from "ai";

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

  // Validate a message to ensure it won't cause conversion errors
  const isValidMessage = useCallback((msg: UIMessage): boolean => {
    // UIMessage always has parts array in AI SDK 6+
    // Check that parts exists and is non-empty
    if (!msg.parts || !Array.isArray(msg.parts) || msg.parts.length === 0) {
      return false;
    }

    // Check each part for validity
    return msg.parts.every(
      (part: {
        type: string;
        text?: string;
        state?: string;
        result?: { content?: unknown };
      }) => {
        // Text parts are always valid
        if (part.type === "text") {
          return true;
        }

        // Tool invocation parts must be complete (have result) if state is "call" or "result"
        if (part.type === "tool-invocation") {
          const invocation = part as any;
          // If it's in "call" or "result" state, it must have a result
          if (invocation.state === "call" || invocation.state === "result") {
            const content = invocation.result?.content;
            // Ensure content exists and is not an empty array
            return (
              content && (Array.isArray(content) ? content.length > 0 : true)
            );
          }
          // partial-call state is okay without result
          return true;
        }

        // Other part types are assumed valid
        return true;
      },
    );
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
        const parsed = JSON.parse(stored) as UIMessage[];
        // Validate the data structure
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Filter out any invalid or incomplete messages
          const validMessages = parsed.filter(isValidMessage);
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
  }, [isAuthenticated, isCacheExpired, updateTimestamp, isValidMessage]);

  // Function to save messages
  const saveMessages = useCallback(
    (messages: UIMessage[]) => {
      if (!isAuthenticated || messages.length === 0) return;

      try {
        // Filter out invalid messages before storing
        const validMessages = messages.filter(isValidMessage);

        // Only store the most recent valid messages to avoid storage limits
        const messagesToStore = validMessages.slice(-MAX_STORED_MESSAGES);

        // Don't save if there are no valid messages
        if (messagesToStore.length === 0) {
          localStorage.removeItem(CHAT_STORAGE_KEY);
          localStorage.removeItem(TIMESTAMP_STORAGE_KEY);
          return;
        }

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
            const validMessages = messages.filter(isValidMessage);
            const recentMessages = validMessages.slice(-50); // Keep only last 50
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
    [isAuthenticated, updateTimestamp, isValidMessage],
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
