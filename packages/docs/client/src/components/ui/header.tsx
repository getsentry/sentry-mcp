import { SentryIcon } from "./icons/sentry";
import { Button } from "./button";

export function Header() {
  return (
    <header className="sticky top-0 z-10 backdrop-blur border-b border-slate-800 bg-black/50">
      <div className="h-14 mx-auto max-w-[1200px] px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SentryIcon className="h-7 w-7 text-violet-400" />
          <div className="text-lg font-semibold">Sentry MCP</div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="secondary">
            <a
              href="https://github.com/getsentry/sentry-mcp"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </Button>
        </div>
      </div>
    </header>
  );
}
