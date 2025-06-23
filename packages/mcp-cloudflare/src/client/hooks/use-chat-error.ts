/**
 * Hook for handling chat errors with proper actions
 * Provides a React-friendly interface to the chat error handler utilities
 */

import { useCallback } from "react";
import { useAuthContext } from "../contexts/auth-context";
import { handleChatError } from "../utils/chat-error-handler";

export function useChatError() {
  const { clearAuthState } = useAuthContext();

  const handleError = useCallback(
    (error: Error) => {
      handleChatError(error, {
        onClearAuth: clearAuthState,
        onShowError: (message) => {
          // For now, just log errors. In the future, we could show toast notifications
          console.error("Chat error message:", message);
        },
      });
    },
    [clearAuthState],
  );

  return { handleError };
}
