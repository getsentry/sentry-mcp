export default function Footer() {
  return (
    <>
      <div className="group inset-x-0 bottom-14 bg-[#201633] w-full h-32 bg-fixed z-10 border-t flex-col bg-clip-padding border-white/20 flex font-mono gap-6 justify-around">
        <div className="flex gap-6 justify-center">
          <a
            href="https://github.com/getsentry/sentry-mcp"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline opacity-80 hover:opacity-100"
          >
            Github
          </a>
          <a
            href="https://discord.com/invite/sentry"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline opacity-80 hover:opacity-100"
          >
            Discord
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
            <div className="absolute inset-0 size-full group-hover/link:opacity-50 group-hover/link:delay-0 duration-300 group-hover/link:translate-1">
              Sentry Docs
            </div>
            <div className="perspective-distant transform-3d duration-300 group-hover/link:translate-2 group-hover/link:translate-z-96">
              Sentry Docs
            </div>
          </a>
        </div>
      </div>
      <div className="group inset-x-0 bottom-0 bg-[#201633] w-full h-14 bg-fixed bg-[repeating-linear-gradient(45deg,#fff2,#fff2_4px,#fff0_4.5px,#fff0_12px)] z-10 border-t flex justify-center items-center bg-clip-padding border-white/20 opacity-75">
        <span className="opacity-50 text-xs">
          © {new Date().getFullYear()} Functional Software, Inc. (d.b.a.
          Sentry). All rights reserved.
        </span>
      </div>
    </>
  );
}
