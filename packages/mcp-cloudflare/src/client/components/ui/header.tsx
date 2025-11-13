import type React from "react";
import { SentryIcon } from "./icons/sentry";
import { Github, PanelLeftClose } from "lucide-react";
import { Button } from "./button";
import { Badge } from "./badge";

interface HeaderProps {
  toggleChat?: (open: boolean) => void;
  isChatOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ toggleChat, isChatOpen }) => {
  return (
    <header className="pl-4 container mx-auto w-full px-4 sm:px-8 sticky py-4 top-0 z-30 backdrop-blur-xl bg-gradient-to-b from-background to-1% to-background/80">
      {/* <div className="absolute inset-0 h-full w-full -z-10 pointer-events-none bg-gradient-to-r from-transparent to-background-2 hidden md:block" /> */}
      <div className="absolute inset-0 h-full w-screen left-1/2 -translate-x-1/2 [mask-image:linear-gradient(to_right,transparent,red_4rem,red_calc(100%-4rem),transparent)] border-b-[1px] border-white/15 pointer-events-none -z-10" />
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2 flex-shrink-0">
          <SentryIcon className="h-8 w-8" />
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl font-semibold whitespace-nowrap">
              Sentry MCP
            </h1>
            <Badge
              variant="outline"
              className="text-xs border border-violet-300/50 bg-background-3 font-normal"
            >
              Beta
            </Badge>
          </div>
        </div>
        <div
          className={`flex items-center gap-4 motion-safe:duration-300 [--x:0] xl:[--x:30rem] 2xl:[--x:38rem] ${
            isChatOpen ? "-translate-x-[var(--x)]" : ""
          }`}
        >
          <Button
            className="rounded-xl max-md:!py-3 max-md:!px-2.25"
            variant="secondary"
            asChild
          >
            <a
              href="https://github.com/getsentry/sentry-mcp"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="h-5 w-5" />
              <span className="max-sm:sr-only">GitHub</span>
            </a>
          </Button>
          {toggleChat && isChatOpen !== undefined && (
            <Button
              type="button"
              onClick={() => toggleChat(!isChatOpen)}
              className="cursor-pointer pl-3 pr-3.5 py-2 rounded-xl max-md:!py-3 max-md:!px-2.25 flex items-center bg-violet-300 text-background hover:bg-white/90 transition font-bold font-sans border border-background"
            >
              <PanelLeftClose className="size-4" />
              <span className="max-sm:sr-only">Live Demo</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};
