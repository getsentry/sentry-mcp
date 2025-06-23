/**
 * Utility for handling chat API errors
 * Extracts error parsing logic from components
 */

import type { ParsedError, ChatErrorData } from "../components/chat/types";

export interface ChatErrorAction {
  type: "CLEAR_AUTH" | "SHOW_ERROR" | "LOG_ONLY";
  message?: string;
}

/**
 * Parse error from the chat API
 */
export function parseChatError(error: Error): ParsedError {
  const result: ParsedError = {
    statusCode: undefined,
    errorName: undefined,
    errorData: null,
  };

  try {
    // Extract status code from error message (e.g., "Error: 401")
    const statusMatch = error.message.match(/\b(\d{3})\b/);
    if (statusMatch) {
      result.statusCode = Number.parseInt(statusMatch[1], 10);
    }

    // Try to parse JSON error response from message
    const jsonMatch = error.message.match(/\{.*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]) as ChatErrorData;
      result.errorData = data;
      result.errorName = data.name;
    }
  } catch {
    // Ignore parsing errors
  }

  return result;
}

/**
 * Determine what action to take based on the error
 */
export function getChatErrorAction(parsedError: ParsedError): ChatErrorAction {
  const { statusCode, errorName } = parsedError;

  // Authentication errors - need to clear auth and re-login
  if (statusCode === 401) {
    return {
      type: "CLEAR_AUTH",
      message: "Your session has expired. Please log in again.",
    };
  }

  // Permission errors - show error but keep auth
  if (statusCode === 403) {
    if (errorName === "INSUFFICIENT_PERMISSIONS") {
      return {
        type: "SHOW_ERROR",
        message: "You don't have permission to access this organization.",
      };
    }
  }

  // Rate limiting
  if (statusCode === 429) {
    if (errorName === "RATE_LIMIT_EXCEEDED" || errorName === "AI_RATE_LIMIT") {
      return {
        type: "SHOW_ERROR",
        message:
          "You've sent too many messages. Please wait a moment before trying again.",
      };
    }
  }

  // Server errors
  if (statusCode === 500) {
    return {
      type: "LOG_ONLY",
      message: "Something went wrong on our end. Please try again.",
    };
  }

  // Default
  return {
    type: "SHOW_ERROR",
    message: "An error occurred. Please try again.",
  };
}

/**
 * Handle chat error with appropriate action
 */
export function handleChatError(
  error: Error,
  callbacks: {
    onClearAuth?: () => void;
    onShowError?: (message: string) => void;
  },
): void {
  const parsedError = parseChatError(error);
  const action = getChatErrorAction(parsedError);

  console.error("Chat error:", {
    error,
    parsedError,
    action,
  });

  switch (action.type) {
    case "CLEAR_AUTH":
      callbacks.onClearAuth?.();
      break;
    case "SHOW_ERROR":
      callbacks.onShowError?.(action.message || "An error occurred");
      break;
    case "LOG_ONLY":
      // Already logged above
      break;
  }
}
