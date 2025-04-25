import { Copy } from "lucide-react";
import { Button } from "./button";

export default function CodeSnippet({ snippet }: { snippet: string }) {
  return (
    <div className="relative text-white bg-gray-900 mb-6">
      <div className="absolute right-2 top-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-gray-400 hover:text-white hover:bg-gray-800 cursor-pointer"
          onClick={() => {
            navigator.clipboard.writeText(snippet);
          }}
        >
          <Copy className="h-4 w-4" />
          <span className="sr-only">Copy Snippet</span>
        </Button>
      </div>
      <pre className="p-4 overflow-x-auto text-gray-200 text-sm">{snippet}</pre>
    </div>
  );
}
