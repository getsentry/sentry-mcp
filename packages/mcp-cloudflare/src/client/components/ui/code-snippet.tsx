import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";

export default function CodeSnippet({
  snippet,
  noMargin,
}: {
  snippet: string;
  noMargin?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`relative text-white ${noMargin ? "" : "mb-6"}`}>
      <div className="absolute top-2.5 right-2.5 flex items-center justify-end">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-500 cursor-pointer"
          onClick={() => {
            navigator.clipboard.writeText(snippet);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4 text-slate-500" />
          )}
          <span className="sr-only">Copy Snippet</span>
        </Button>
      </div>
      <pre
        className="p-4 overflow-x-auto text-slate-200 text-sm bg-slate-950"
        style={{ margin: 0 }}
      >
        {snippet}
      </pre>
    </div>
  );
}
