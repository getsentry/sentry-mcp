import { useState } from "react";
import { Bolt, ChevronDown, ChevronRight } from "lucide-react";
import { Prose } from "../ui/prose";

interface TextMessage {
  type: "text";
  text: string;
}

interface UnknownMessage {
  type: string;
  [key: string]: unknown;
}

type ToolMessage = TextMessage | UnknownMessage;

// Try to use the ToolInvocation type from the message structure based on the AI SDK docs
interface ToolInvocation {
  toolCallId: string;
  toolName: string;
  args: any;
  state: "partial-call" | "call" | "result";
  result?: {
    content: ToolMessage[];
  };
}

interface ToolInvocationProps {
  tool: ToolInvocation;
  messageId: string;
  index: number;
}

function getTokenCount(content: ToolMessage[]) {
  return content.reduce((acc, message) => {
    if (message.type === "text") {
      return acc + (message as TextMessage).text.length;
    }
    return acc;
  }, 0);
}

export function ToolInvocation({
  tool,
  messageId,
  index,
}: ToolInvocationProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border border-slate-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-3 text-left cursor-pointer hover:bg-slate-900/50 transition-colors"
      >
        <div className="flex items-center gap-2 text-violet-400">
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <Bolt className="h-3 w-3" />
          <span className="font-mono">{tool.toolName}</span>
          {tool.state === "result" && (
            <span className="text-xs text-slate-500 ml-auto">
              {`~${getTokenCount(tool.result?.content ?? []).toLocaleString()}
              tokens`}
            </span>
          )}
        </div>
      </button>

      {isExpanded && tool.state === "result" && tool.result && (
        <div className="px-3 pb-3 border-t border-slate-600/30">
          <div className="mt-2">
            <ToolContent content={tool.result.content} />
          </div>
        </div>
      )}
    </div>
  );
}

export function ToolContent({ content }: { content: ToolMessage[] }) {
  return (
    <div className="space-y-3">
      {content.map((message: ToolMessage, index: number) => (
        <div key={`message-${message.type}-${index}`} className="space-y-2">
          {message.type === "text" ? (
            <div className="flex items-start gap-2">
              <pre className="text-slate-300 text-sm whitespace-pre-wrap overflow-x-auto">
                {(message as TextMessage).text}
              </pre>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="text-xs text-slate-500 uppercase tracking-wide">
                {message.type}
              </div>
              <div className="bg-slate-900/30 rounded p-3 text-sm">
                <pre className="text-slate-300 whitespace-pre-wrap overflow-x-auto">
                  {JSON.stringify(message, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
