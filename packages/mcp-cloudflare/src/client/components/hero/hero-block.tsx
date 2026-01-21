import TerminalAnimation from "../animation/TerminalAnimation";
import CodeSnippet from "../ui/code-snippet";
import { openCursorDeepLink } from "@/client/utils";
import { CursorIcon } from "../ui/icons/cursor";

export default function HeroBlock() {
  const endpoint = new URL("/mcp", window.location.href).href;

  return (
    <div className="flex-1 flex flex-col container mx-auto min-h-[min(80rem,calc(100svh-69px))]">
      <div className="grid xl:grid-cols-2 gap-4 sm:gap-8 sm:px-8 sm:py-6 px-4 pt-3 max-sm:text-sm">
        <p className="text-white/70 max-w-[69ch]">
          Sentry MCP plugs Sentry's API directly into your LLM, letting you ask
          questions about your data in natural language. Take a coding agent you
          already use - like Cursor or Claude Code - and pull in information
          from Sentry to help with debugging, fixing production errors, and
          understanding your application's behavior.
        </p>
        <div className="flex h-full items-center xl:justify-end sm:gap-6 gap-2 flex-wrap">
          <div className="w-full sm:contents">
            <CodeSnippet noMargin snippet={endpoint} />
          </div>
          <button
            type="button"
            aria-label="Install in Cursor"
            onClick={() => openCursorDeepLink(endpoint)}
            className="relative hidden md:block size-fit my-2 group cursor-pointer outline-none rounded-xl ring-offset-2 ring-offset-background focus-visible:ring-violet-300 focus-visible:ring-[3px]"
          >
            <div className="absolute inset-0 size-full rounded-xl bg-violet-400/80 bg-[repeating-linear-gradient(-45deg,var(--bg1),var(--bg1)_0.5px,#fff0_0.5px,#fff0_12px)]" />
            <div className="bg-grid absolute inset-0 size-full duration-200 delay-50 opacity-100 [--size:10px] [--grid-color:#0002] bg-pink-400 group-hover:rotate-x-15 group-hover:translate-1 group-hover:-rotate-y-2 !px-6 transform-3d perspective-distant rounded-xl ease-[cubic-bezier(0.175,0.885,0.32,1.275)] origin-bottom-right group-active:rotate-y-1 group-active:translate-0.5 group-active:rotate-x-3" />
            <div className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive cursor-pointer shadow-xs hover:text-black py-2 has-[>svg]:px-3 h-13 group-hover:rotate-x-30 group-hover:translate-2 group-hover:-rotate-y-4 group-active:rotate-x-6 group-active:translate-1 group-active:rotate-y-2 !px-6 relative rounded-xl bg-white text-black duration-200 hover:bg-white transform-3d perspective-distant backface-hidden ease-[cubic-bezier(0.175,0.885,0.32,1.275)] origin-bottom-right">
              <div className="bg-grid absolute inset-0 opacity-0 duration-300 group-hover:opacity-30 [--size:10px] [--grid-color:#44130644] [mask-image:radial-gradient(ellipse_at_center,transparent,red)]" />
              <CursorIcon />
              Install in Cursor
            </div>
          </button>
        </div>
      </div>
      {/* demo */}
      <div
        className="overflow-wrap p-4 sm:p-8 overflow-visible relative grid h-full flex-1 w-full gap-8 rounded-2xl xl:grid-cols-4 bg-gradient-to-r from-400/50 to-500 text-white/70 grid-cols-1 grid-rows-6 xl:grid-rows-1"
        id="demo"
      >
        <TerminalAnimation />
      </div>
    </div>
  );
}
