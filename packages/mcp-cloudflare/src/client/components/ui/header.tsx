import type React from "react";
import { SentryIcon } from "./icons/sentry";
import { Github, LogOut } from "lucide-react";
import { Button } from "./button";

interface HeaderProps {
  isAuthenticated?: boolean;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isAuthenticated,
  onLogout,
}) => {
  return (
    <header className="mb-6 w-full">
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2 flex-shrink-0">
          <SentryIcon className="h-8 w-8 text-violet-400" />
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl font-bold whitespace-nowrap">Sentry MCP</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" asChild>
            <a
              href="https://github.com/getsentry/sentry-mcp"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="h-5 w-5" />
              <span>GitHub</span>
            </a>
          </Button>
          {isAuthenticated && onLogout && (
            <Button
              variant="secondary"
              onClick={onLogout}
              className="hidden md:flex cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
              <span>Logout</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};
