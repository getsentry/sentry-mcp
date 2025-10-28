import { SentryIcon } from "../ui/icons/sentry";

export default function Footer({ isChatOpen }: { isChatOpen: boolean }) {
  return (
    <>
      <div
        className={`group inset-x-0 bottom-14 bg-[#201633] w-full h-40 bg-fixed z-10 border-t flex-col bg-clip-padding border-white/20 flex font-mono py-6 justify-around duration-300 [--x:0] xl:[--x:20rem] 2xl:[--x:24rem] ${
          isChatOpen && "xl:-translate-x-[var(--x)]"
        }`}
      >
        <div className="flex items-center gap-2 flex-shrink-0 mx-auto font-sans">
          <SentryIcon className="h-8 w-8" />
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl font-medium whitespace-nowrap">
              Sentry MCP
            </h1>
          </div>
        </div>
        <div className="flex gap-6 justify-center">
          <a
            href="https://github.com/getsentry/sentry-mcp"
            target="_blank"
            rel="noopener noreferrer"
            className="relative hover:underline opacity-80 hover:opacity-100 group/link"
          >
            <div className="absolute inset-0 size-full text-violet-500 group-hover/link:opacity-50 group-hover/link:delay-0 delay-300">
              Github
            </div>
            <div
              className="absolute inset-0 size-full group-hover/link:opacity-50 group-hover/link:delay-0 duration-300 group-hover/link:translate-y-1 group-hover/link:-translate-x-1"
              aria-hidden="true"
            >
              Github
            </div>
            <div
              className="perspective-distant transform-3d duration-300 group-hover/link:translate-y-2 group-hover/link:-translate-x-2"
              role="presentation"
            >
              Github
            </div>
          </a>
          <a
            href="https://discord.com/invite/sentry"
            target="_blank"
            rel="noopener noreferrer"
            className="relative hover:underline opacity-80 hover:opacity-100 group/link"
          >
            <div className="absolute inset-0 size-full text-violet-500 group-hover/link:opacity-50 group-hover/link:delay-0 delay-300">
              Discord
            </div>
            <div
              className="absolute inset-0 size-full group-hover/link:opacity-50 group-hover/link:delay-0 duration-300 group-hover/link:translate-y-1"
              aria-hidden="true"
            >
              Discord
            </div>
            <div
              className="perspective-distant transform-3d duration-300 group-hover/link:translate-y-2"
              role="presentation"
            >
              Discord
            </div>
          </a>
          <a
            href="https://docs.sentry.io/product/sentry-mcp/"
            target="_blank"
            rel="noopener noreferrer"
            className="relative hover:underline opacity-80 hover:opacity-100 group/link"
          >
            <div className="absolute inset-0 size-full text-violet-500 group-hover/link:opacity-50 group-hover/link:delay-0 delay-300">
              Sentry Docs
            </div>
            <div
              className="absolute inset-0 size-full group-hover/link:opacity-50 group-hover/link:delay-0 duration-300 group-hover/link:translate-1"
              aria-hidden="true"
            >
              Sentry Docs
            </div>
            <div
              className="perspective-distant transform-3d duration-300 group-hover/link:translate-2"
              role="presentation"
            >
              Sentry Docs
            </div>
          </a>
        </div>
      </div>
      <div
        className={`group inset-x-0 bottom-0 bg-[#201633] w-full h-14 bg-fixed bg-[repeating-linear-gradient(45deg,#fff2,#fff2_4px,#fff0_4.5px,#fff0_12px)] z-10 border-t flex justify-center items-center bg-clip-padding border-white/20 opacity-75 [--x:0] xl:[--x:20rem] 2xl:[--x:24rem] duration-300 ${
          isChatOpen && "xl:-translate-x-[var(--x)]"
        }`}
      >
        <span className="opacity-50 text-xs text-center max-w-2/3">
          © {new Date().getFullYear()} Functional Software, Inc. (d.b.a.
          Sentry). All rights reserved.
        </span>
      </div>
    </>
  );
}
