/**
 * Type definitions for Chat components
 */

import type { Message } from "ai/react";

// Re-export AI SDK types for convenience
export type { Message } from "ai/react";

// Error handling types (simplified)
// We only keep this for potential server response parsing
export interface ChatErrorData {
  error?: string;
  name?: string;
  eventId?: string;
  statusCode?: number;
  message?: string;
}

// Authentication types
export interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  authToken: string;
  isAuthenticating: boolean;
  authError: string;
}

export interface AuthActions {
  handleOAuthLogin: () => void;
  handleLogout: () => void;
  clearAuthState: () => void;
}

export type AuthContextType = AuthState & AuthActions;

// OAuth message types
export interface OAuthSuccessMessage {
  type: "SENTRY_AUTH_SUCCESS";
  data: {
    accessToken: string;
  };
}

export interface OAuthErrorMessage {
  type: "SENTRY_AUTH_ERROR";
  error?: string;
}

export type OAuthMessage = OAuthSuccessMessage | OAuthErrorMessage;

// Tool invocation types
export interface ToolInvocationContent {
  type: "text";
  text: string;
}

export interface ToolInvocationUnknownContent {
  type: string;
  [key: string]: unknown;
}

export type ToolMessage = ToolInvocationContent | ToolInvocationUnknownContent;

// Define our own ToolInvocation interface since AI SDK's is not properly exported
export interface ChatToolInvocation {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  state: "partial-call" | "call" | "result";
  result?: {
    content: ToolMessage[];
  };
}

// Message processing types
export interface ProcessedMessagePart {
  part: NonNullable<Message["parts"]>[number];
  messageId: string;
  messageRole: string;
  partIndex: number;
  isStreaming: boolean;
}

// Component prop types
export interface ChatProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface ChatMessagesProps {
  messages: Message[];
  isChatLoading: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

export interface ChatInputProps {
  input: string;
  isLoading: boolean;
  isOpen: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
}

export interface AuthFormProps {
  authError: string;
  isAuthenticating: boolean;
  onOAuthLogin: () => void;
}

export interface PanelBackdropProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface MessagePartProps {
  part: NonNullable<Message["parts"]>[number];
  messageId: string;
  messageRole: string;
  partIndex: number;
  isStreaming?: boolean;
}

export interface TextPartProps {
  text: string;
  role: string;
  messageId: string;
  isStreaming?: boolean;
}

export interface ToolPartProps {
  toolInvocation: ChatToolInvocation;
  messageId: string;
  partIndex: number;
}

export interface ToolInvocationProps {
  tool: ChatToolInvocation;
  messageId: string;
  index: number;
}

// Type guards
export function isTextMessage(
  message: ToolMessage,
): message is ToolInvocationContent {
  return message.type === "text";
}

export function isOAuthSuccessMessage(
  message: unknown,
): message is OAuthSuccessMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "SENTRY_AUTH_SUCCESS"
  );
}

export function isOAuthErrorMessage(
  message: unknown,
): message is OAuthErrorMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "SENTRY_AUTH_ERROR"
  );
}
