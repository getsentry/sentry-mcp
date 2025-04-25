import type React from "react";
import { SentryIcon } from "./icons/sentry";
import { Github } from "lucide-react";

export const Header: React.FC = () => {
  return (
    <header className="mb-6 w-full">
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2 flex-shrink-0">
          <SentryIcon className="h-8 w-8 text-violet-400" />
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl font-bold whitespace-nowrap">Sentry MCP</h1>
          </div>
        </div>
        <a
          href="https://github.com/getsentry/sentry-mcp"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-700 transition-colors flex-shrink-0"
        >
          <Github className="h-5 w-5" />
          <span>GitHub</span>
        </a>
      </div>
    </header>
  );
};
