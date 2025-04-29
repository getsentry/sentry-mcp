import type React from "react";
import { SentryIcon } from "./icons/sentry";
import { Github } from "lucide-react";
import { Button } from "./button";

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
        <Button variant="outline" asChild>
          <a
            href="https://github.com/getsentry/sentry-mcp"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Github className="h-5 w-5" />
            <span>GitHub</span>
          </a>
        </Button>
      </div>
    </header>
  );
};
