import { memo } from "react";
import { Markdown } from "../ui/markdown";
import { InteractiveMarkdown } from "../ui/interactive-markdown";
import { Typewriter } from "../ui/typewriter";
import { ToolInvocation } from "./tool-invocation";
import { Terminal } from "lucide-react";
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
  messageData,
  onSlashCommand,
}: TextPartProps) {
  const isAssistant = role === "assistant";
  const isUser = role === "user";
  const isSlashCommand = isUser && text.startsWith("/");
  const isPromptExecution = isUser && messageData?.type === "prompt-execution";

  if (isUser) {
    // User messages: flexible width with background
    return (
      <div className="flex justify-end">
        <div
          className={`px-4 py-2 rounded max-w-3xl ${
            isSlashCommand
              ? "bg-blue-900/50 border border-blue-700/50"
              : isPromptExecution
                ? "bg-purple-900/50 border border-purple-700/50"
                : "bg-slate-800"
          }`}
        >
          {isSlashCommand ? (
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-blue-400" />
              <span className="text-blue-300 font-mono text-sm">{text}</span>
            </div>
          ) : isPromptExecution ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-purple-400" />
                <span className="text-purple-300 font-semibold text-sm">
                  Prompt: {messageData.promptName}
                </span>
              </div>
              {messageData.parameters &&
                Object.keys(messageData.parameters).length > 0 && (
                  <div className="text-xs text-purple-200/80 ml-6">
                    {Object.entries(messageData.parameters).map(
                      ([key, value]) => (
                        <div key={key}>
                          <span className="text-purple-300">{key}:</span>{" "}
                          {String(value)}
                        </div>
                      ),
                    )}
                  </div>
                )}
              {messageData.wasExecuted && (
                <div className="text-xs text-purple-200/60 ml-6 italic">
                  ✓ Executed on server
                </div>
              )}
            </div>
          ) : (
            <Markdown>{text}</Markdown>
          )}
        </div>
      </div>
    );
  }

  // Assistant and system messages: no background, just text
  // System messages should animate if they're marked for streaming simulation
  const shouldAnimate =
    (isAssistant && isStreaming) ||
    (role === "system" && isStreaming && messageData?.simulateStreaming);
  const hasSlashCommands = messageData?.hasSlashCommands;

  return (
    <div className="mr-8">
      {shouldAnimate ? (
        <Typewriter text={text} speed={20}>
          {(displayedText) => (
            <InteractiveMarkdown
              hasSlashCommands={hasSlashCommands}
              onSlashCommand={onSlashCommand}
            >
              {displayedText}
            </InteractiveMarkdown>
          )}
        </Typewriter>
      ) : (
        <InteractiveMarkdown
          hasSlashCommands={hasSlashCommands}
          onSlashCommand={onSlashCommand}
        >
          {text}
        </InteractiveMarkdown>
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
  messageData,
  onSlashCommand,
}: MessagePartProps) {
  switch (part.type) {
    case "text":
      return (
        <TextPart
          text={part.text}
          role={messageRole}
          messageId={messageId}
          isStreaming={isStreaming}
          messageData={messageData}
          onSlashCommand={onSlashCommand}
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
