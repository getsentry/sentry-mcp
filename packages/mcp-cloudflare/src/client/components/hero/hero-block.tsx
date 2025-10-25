import TerminalAnimation from "../animation/TerminalAnimation";
import { Button } from "../ui/button";
import CodeSnippet from "../ui/code-snippet";

export default function HeroBlock() {
  const endpoint = new URL("/mcp", window.location.href).href;

  return (
    <div className="flex-1 flex flex-col container mx-auto max-h-[80rem] h-[calc(100svh-69px)]">
      <div className="grid xl:grid-cols-2 gap-8 sm:px-8 sm:py-6 px-4 py-3">
        <p className="text-white/70 max-w-[69ch] max-sm:hidden">
          Simply put, it's a way to plug Sentry's API into an LLM, letting you
          ask questions about your data in context of the LLM itself. This lets
          you take a coding agent that you already use, like Cursor or Claude
          Code, and pull in additional information from Sentry to help with
          tasks like debugging, fixing production errors, and understanding your
          application's behavior.
        </p>
        <div className="flex h-full items-center xl:justify-end gap-6 flex-wrap">
          <CodeSnippet noMargin snippet={endpoint} />
          <a
            href="cursor://anysphere.cursor-deeplink/mcp/install?name=Sentry&config=eyJ1cmwiOiJodHRwczovL21jcC5zZW50cnkuZGV2L21jcCJ9"
            className="relative size-fit my-2 group cursor-pointer"
          >
            <div className="absolute inset-0 size-full rounded-xl bg-violet-400/80 bg-[repeating-linear-gradient(-45deg,var(--background),var(--background)_0.5px,#fff0_0.5px,#fff0_12px)]" />
            <div className="bg-grid absolute inset-0 size-full duration-200 delay-50 opacity-100 [--size:10px] [--grid-color:#0002] bg-pink-400 group-hover:rotate-x-15 group-hover:translate-1 group-hover:-rotate-y-2 !px-6 transform-3d perspective-distant rounded-xl ease-[cubic-bezier(0.175,0.885,0.32,1.275)] origin-bottom-right group-active:rotate-y-1 group-active:translate-0.5 group-active:rotate-x-3" />
            <Button
              variant="secondary"
              onClick={() => {
                const deepLink =
                  "cursor://anysphere.cursor-deeplink/mcp/install?name=Sentry&config=eyJ1cmwiOiJodHRwczovL21jcC5zZW50cnkuZGV2L21jcCJ9";
                window.location.href = deepLink;
              }}
              className="h-13 group-hover:rotate-x-30 group-hover:translate-2 group-hover:-rotate-y-4 group-active:rotate-x-6 group-active:translate-1 group-active:rotate-y-2 !px-6 relative rounded-xl bg-white text-black duration-200 hover:bg-white transform-3d perspective-distant backface-hidden ease-[cubic-bezier(0.175,0.885,0.32,1.275)] origin-bottom-right "
            >
              <div className="bg-grid absolute inset-0 opacity-0 duration-300 group-hover:opacity-30 [--size:10px] [--grid-color:#44130644] [mask-image:radial-gradient(ellipse_at_center,transparent,red)]" />
              <svg
                xmlns="http://www.w3.org/2000/svg"
                version="1.1"
                className="size-4"
                viewBox="0 0 466.73 532.09"
                aria-hidden="true"
              >
                <path
                  className="fill-current"
                  d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75,3.32,9.3,9.46,9.3,16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z"
                />
              </svg>
              Install in Cursor
            </Button>
          </a>
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
