import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { MessagePart } from ".";
import type { Message } from "ai/react";

export interface ProcessedMessagePart {
  part: NonNullable<Message["parts"]>[number];
  messageId: string;
  messageRole: string;
  partIndex: number;
  isLastMessage: boolean;
  isStreaming: boolean;
}

interface ChatMessagesProps {
  messages: Message[];
  isChatLoading: boolean;
}

function processMessages(
  messages: Message[],
  isChatLoading: boolean,
): ProcessedMessagePart[] {
  const allParts: ProcessedMessagePart[] = [];

  messages.forEach((message, messageIndex) => {
    const isLastMessage = messageIndex === messages.length - 1;

    // Handle messages with parts array
    if (message.parts && message.parts.length > 0) {
      message.parts.forEach((part, partIndex) => {
        allParts.push({
          part,
          messageId: message.id,
          messageRole: message.role,
          partIndex,
          isLastMessage,
          isStreaming: isLastMessage && isChatLoading && part.type === "text",
        });
      });
    } else if (message.content) {
      // Handle messages with just content (fallback)
      allParts.push({
        part: { type: "text", text: message.content },
        messageId: message.id,
        messageRole: message.role,
        partIndex: 0,
        isLastMessage,
        isStreaming: isLastMessage && isChatLoading,
      });
    }
  });

  return allParts;
}

export const ChatMessages = forwardRef<HTMLDivElement, ChatMessagesProps>(
  ({ messages, isChatLoading }, ref) => {
    const processedParts = processMessages(messages, isChatLoading);
    return (
      <div ref={ref} className="flex-1 overflow-y-auto m-6 space-y-4">
        {/* Empty State when no messages */}
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-slate-400">
              <h2 id="chat-panel-title" className="text-lg mb-2">
                Chat with your stack traces. Argue with confidence. Lose
                gracefully.
              </h2>
              <p className="text-sm">
                Try asking: "What are my recent issues?" or "Show me projects in
                my organization"
              </p>
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
