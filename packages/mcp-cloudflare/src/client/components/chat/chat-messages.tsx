import { forwardRef, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { MessagePart } from ".";
import type { Message } from "ai/react";

export interface ProcessedMessagePart {
  part: NonNullable<Message["parts"]>[number];
  messageId: string;
  messageRole: string;
  partIndex: number;
  isStreaming: boolean;
}

interface ChatMessagesProps {
  messages: Message[];
  isChatLoading: boolean;
}

// Cache for stable part objects to avoid recreating them
const partCache = new WeakMap<Message, { type: "text"; text: string }>();

function processMessages(
  messages: Message[],
  isChatLoading: boolean,
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
          // Only stream if it's the last text part of the last message and chat is loading
          isStreaming:
            isLastPartOfLastMessage && isChatLoading && part.type === "text",
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
        // Only stream if it's the last message and chat is loading
        isStreaming: isLastMessage && isChatLoading,
      });
    }
  });

  return allParts;
}

export const ChatMessages = forwardRef<HTMLDivElement, ChatMessagesProps>(
  ({ messages, isChatLoading }, ref) => {
    const processedParts = useMemo(
      () => processMessages(messages, isChatLoading),
      [messages, isChatLoading],
    );
    return (
      <div ref={ref} className="flex-1 overflow-y-auto m-6 space-y-4">
        {/* Empty State when no messages */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="max-w-md w-full space-y-6">
              <div className="text-slate-400 hidden [@media(min-height:500px)]:block">
                <img
                  src="/flow-transparent.png"
                  alt="Flow"
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
            {processedParts.map((item) => (
              <MessagePart
                key={`${item.messageId}-part-${item.partIndex}`}
                part={item.part}
                messageId={item.messageId}
                messageRole={item.messageRole}
                partIndex={item.partIndex}
                isStreaming={item.isStreaming}
              />
            ))}

            {isChatLoading && (
              <div className="flex items-center space-x-2 text-slate-400 mr-8">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Assistant is thinking...</span>
              </div>
            )}
          </>
        )}
      </div>
    );
  },
);

ChatMessages.displayName = "ChatMessages";
