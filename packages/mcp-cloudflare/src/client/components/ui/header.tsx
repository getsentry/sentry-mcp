import type React from "react";
import { SentryIcon } from "./icons/sentry";
import { Github, LogOut } from "lucide-react";
import { Button } from "./button";
import { Badge } from "./badge";

interface HeaderProps {
  isAuthenticated?: boolean;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isAuthenticated,
  onLogout,
}) => {
  return (
    <header className="mb-4 sm:mb-8 pl-4 sm:px-0 w-full">
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2 flex-shrink-0">
          <SentryIcon className="h-8 w-8" />
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl font-semibold whitespace-nowrap">
              Sentry MCP
            </h1>
            <Badge
              variant="outline"
              className="text-xs text-muted-foreground font-normal"
            >
              Beta
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button className="rounded-xl" variant="secondary" asChild>
            <a
              href="https://github.com/getsentry/sentry-mcp"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="h-5 w-5" />
              <span className="max-sm:sr-only">GitHub</span>
            </a>
          </Button>
          {isAuthenticated && onLogout && (
            <Button
              variant="secondary"
              onClick={onLogout}
              className="cursor-pointer rounded-xl"
            >
              <LogOut className="h-4 w-4" />
              <span className="max-sm:sr-only">Logout</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};
