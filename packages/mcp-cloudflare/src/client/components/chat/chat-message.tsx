import { Markdown } from "../ui/markdown";
import { Typewriter } from "../ui/typewriter";
import { ToolInvocation } from "./tool-invocation";
import type { Message } from "ai/react";

interface MessagePartProps {
  part: any;
  messageId: string;
  messageRole: string;
  partIndex: number;
  isStreaming?: boolean;
}

interface TextPartProps {
  text: string;
  role: string;
  messageId: string;
  isStreaming?: boolean;
}

interface ToolPartProps {
  toolInvocation: any;
  messageId: string;
  partIndex: number;
}

// Component for rendering text parts
export function TextPart({
  text,
  role,
  messageId,
  isStreaming,
}: TextPartProps) {
  const isAssistant = role === "assistant";

  return (
    <div
      className={`p-4 pb-2 ${
        role === "user" ? "bg-slate-800 ml-8" : "bg-slate-800/40 mr-8"
      }`}
    >
      <div className="text-sm text-slate-400 mb-2">
        {role === "user" ? "You" : "Assistant"}
      </div>
      <div className="text-slate-200">
        {isAssistant && isStreaming ? (
          <Typewriter text={text} speed={20}>
            {(displayedText) => <Markdown>{displayedText}</Markdown>}
          </Typewriter>
        ) : (
          <Markdown>{text}</Markdown>
        )}
      </div>
    </div>
  );
}

// Component for rendering tool invocation parts
export function ToolPart({
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
}

// Main component for rendering individual message parts
export function MessagePart({
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
          toolInvocation={part.toolInvocation}
          messageId={messageId}
          partIndex={partIndex}
        />
      );
    default:
      // Fallback for unknown part types
      return null;
  }
}

// Legacy component for backwards compatibility (can be removed later)
export function ChatMessage({ message }: { message: Message }) {
  // This now just renders the message content as a single text part
  return (
    <TextPart
      text={message.content}
      role={message.role}
      messageId={message.id}
      isStreaming={false}
    />
  );
}
