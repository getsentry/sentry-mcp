import { useMemo } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "../ui/button";
import { MessagePart } from ".";
import { PromptActions } from "../ui/prompt-actions";
import { SlashCommandActions } from "../ui/slash-command-actions";
import type { Message, ProcessedMessagePart, ChatMessagesProps } from "./types";
import { isAuthError, getErrorMessage } from "../../utils/chat-error-handler";
import { useAuth } from "../../contexts/auth-context";

// Cache for stable part objects to avoid recreating them
const partCache = new WeakMap<Message, { type: "text"; text: string }>();

function processMessages(
  messages: Message[],
  isChatLoading: boolean,
  isLocalStreaming?: boolean,
  isMessageStreaming?: (messageId: string) => boolean,
): ProcessedMessagePart[] {
  const allParts: ProcessedMessagePart[] = [];

  // Only the very last text part of the very last message should be streaming
  const lastMessageIndex = messages.length - 1;

  messages.forEach((message, messageIndex) => {
    const isLastMessage = messageIndex === lastMessageIndex;

    // Handle messages with parts array
    if (message.parts && message.parts.length > 0) {
      const lastPartIndex = message.parts.length - 1;

      message.parts.forEach((part, partIndex) => {
        const isLastPartOfLastMessage =
          isLastMessage && partIndex === lastPartIndex;

        allParts.push({
          part,
          messageId: message.id,
          messageRole: message.role,
          partIndex,
          // Stream if it's AI response OR local streaming simulation
          isStreaming:
            (isLastPartOfLastMessage &&
              isChatLoading &&
              part.type === "text") ||
            (part.type === "text" && !!isMessageStreaming?.(message.id)),
        });
      });
    } else if (message.content) {
      // Use cached part object to maintain stable references
      let part = partCache.get(message);
      if (!part) {
        part = { type: "text", text: message.content };
        partCache.set(message, part);
      }

      allParts.push({
        part,
        messageId: message.id,
        messageRole: message.role,
        partIndex: 0,
        // Stream if it's AI response OR local streaming simulation
        isStreaming:
          (isLastMessage && isChatLoading) ||
          isMessageStreaming?.(message.id) ||
          false,
      });
    }
  });

  return allParts;
}

export function ChatMessages({
  messages,
  isChatLoading,
  isLocalStreaming,
  isMessageStreaming,
  error,
  onRetry,
  onPromptSelect,
  onSlashCommand,
}: ChatMessagesProps) {
  const { handleOAuthLogin } = useAuth();

  const processedParts = useMemo(
    () =>
      processMessages(
        messages,
        isChatLoading,
        isLocalStreaming,
        isMessageStreaming,
      ),
    [messages, isChatLoading, isLocalStreaming, isMessageStreaming],
  );

  // Simple error handling - just check if it's auth or not
  const errorIsAuth = error ? isAuthError(error) : false;
  const errorMessage = error ? getErrorMessage(error) : null;
  return (
    <div className="mx-6 mt-6 space-y-4 flex-1">
      {/* Empty State when no messages */}
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full">
          <div className="max-w-md w-full space-y-6">
            <div className="text-slate-400 hidden [@media(min-height:500px)]:block">
              <img
                src="/flow-transparent.png"
                alt="Flow"
                width={1536}
                height={1024}
                className="w-full mb-6 bg-violet-300 rounded"
              />
            </div>

            <div className="text-center text-slate-400">
              <h2 id="chat-panel-title" className="text-lg mb-2">
                Chat with your stack traces. Argue with confidence. Lose
                gracefully.
              </h2>
            </div>
          </div>
        </div>
      )}

      {/* Show messages when we have any */}
      {messages.length > 0 && (
        <>
          <h2 id="chat-panel-title" className="sr-only">
            Chat Messages
          </h2>
          {processedParts.map((item) => {
            // Find the original message to check for metadata
            const originalMessage = messages.find(
              (m) => m.id === item.messageId,
            );
            const messageData = originalMessage?.data as any;
            const hasPromptActions =
              messageData?.type === "prompts-list" &&
              messageData?.prompts &&
              Array.isArray(messageData.prompts);
            const hasSlashCommandActions =
              messageData?.type === "help-message" &&
              messageData?.hasSlashCommands;

            return (
              <div key={`${item.messageId}-part-${item.partIndex}`}>
                <MessagePart
                  part={item.part}
                  messageId={item.messageId}
                  messageRole={item.messageRole}
                  partIndex={item.partIndex}
                  isStreaming={item.isStreaming}
                  messageData={originalMessage?.data}
                  onSlashCommand={onSlashCommand}
                />
                {/* Show prompt actions only for the last part of messages with prompt metadata */}
                {hasPromptActions &&
                  item.partIndex ===
                    (originalMessage?.parts?.length ?? 1) - 1 &&
                  onPromptSelect && (
                    <div className="mr-8 mt-4">
                      <PromptActions
                        prompts={messageData.prompts}
                        onPromptSelect={onPromptSelect}
                      />
                    </div>
                  )}
              </div>
            );
          })}

          {/* Show error or loading state */}
          {error && errorMessage ? (
            <div className="mr-8 p-4 bg-red-900/10 border border-red-500/30 rounded">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
                <div className="flex-1">
                  <p className="text-red-300">{errorMessage}</p>
                  {/* Simple action buttons */}
                  <div className="mt-3 flex gap-2">
                    {errorIsAuth ? (
                      <Button
                        onClick={() => {
                          handleOAuthLogin();
                        }}
                        size="sm"
                        variant="secondary"
                        className="bg-red-900/20 hover:bg-red-900/30 text-red-300 border-red-500/30 cursor-pointer"
                      >
                        Reauthenticate
                      </Button>
                    ) : (
                      onRetry && (
                        <Button
                          onClick={onRetry}
                          size="sm"
                          variant="secondary"
                          className="bg-red-900/20 hover:bg-red-900/30 text-red-300 border-red-500/30 cursor-pointer"
                        >
                          Try again
                        </Button>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : isChatLoading ? (
            <div className="flex items-center space-x-2 text-slate-400 mr-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Assistant is thinking...</span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
