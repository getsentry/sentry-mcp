import { memo } from "react";
import { Markdown } from "../ui/markdown";
import { Typewriter } from "../ui/typewriter";
import { ToolInvocation } from "./tool-invocation";
import type {
  MessagePartProps,
  TextPartProps,
  ToolPartProps,
  ChatToolInvocation,
} from "./types";

// Component for rendering text parts
const TextPart = memo(function TextPart({
  text,
  role,
  messageId,
  isStreaming,
}: TextPartProps) {
  const isAssistant = role === "assistant";
  const isUser = role === "user";

  if (isUser) {
    // User messages: flexible width with background
    return (
      <div className="flex justify-end">
        <div className="bg-slate-800 px-4 rounded max-w-3xl">
          <Markdown>{text}</Markdown>
        </div>
      </div>
    );
  }

  // Assistant messages: no background, just text
  return (
    <div className="mr-8">
      {isAssistant && isStreaming ? (
        <Typewriter text={text} speed={20}>
          {(displayedText) => <Markdown>{displayedText}</Markdown>}
        </Typewriter>
      ) : (
        <Markdown>{text}</Markdown>
      )}
    </div>
  );
});

// Component for rendering tool invocation parts
const ToolPart = memo(function ToolPart({
  toolInvocation,
  messageId,
  partIndex,
}: ToolPartProps) {
  return (
    <div className="mr-8">
      <ToolInvocation
        tool={toolInvocation}
        messageId={messageId}
        index={partIndex}
      />
    </div>
  );
});

// Main component for rendering individual message parts
const MessagePart = memo(function MessagePart({
  part,
  messageId,
  messageRole,
  partIndex,
  isStreaming,
}: MessagePartProps) {
  switch (part.type) {
    case "text":
      return (
        <TextPart
          text={part.text}
          role={messageRole}
          messageId={messageId}
          isStreaming={isStreaming}
        />
      );
    case "tool-invocation":
      return (
        <ToolPart
          toolInvocation={part.toolInvocation as ChatToolInvocation}
          messageId={messageId}
          partIndex={partIndex}
        />
      );
    default:
      // Fallback for unknown part types
      return null;
  }
});

// Export the memoized components
export { TextPart, ToolPart, MessagePart };
