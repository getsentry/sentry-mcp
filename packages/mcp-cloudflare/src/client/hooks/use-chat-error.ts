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
        onClearAuth: () => {
          // Clear auth state without throwing an error
          // This will cause the UI to show the login form
          clearAuthState();
        },
        onShowError: (message) => {
          // The AI SDK's useChat will display the error message
          // So we need to throw a new error with the proper message
          throw new Error(message);
        },
      });
    },
    [clearAuthState],
  );

  return { handleError };
}
