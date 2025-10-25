interface SidebarProps {
  toggleChat: (open: boolean) => void;
  isChatOpen: boolean;
}

export function Sidebars({ isChatOpen, toggleChat }: SidebarProps) {
  return (
    <>
      {/* left sidebar */}
      <aside className="group hidden sm:block fixed left-0 inset-y-0 h-full sm:w-[calc((100vw-40rem)/2)] md:w-[calc((100vw-48rem)/2)] lg:w-[calc((100vw-64rem)/2)] xl:w-[calc((100vw-80rem)/2)] 2xl:w-[calc((100vw-96rem)/2)] bg-fixed bg-[repeating-linear-gradient(-45deg,#fff2,#fff2_1px,#fff0_1.5px,#fff0_12px)] z-10 border-r opacity-50 bg-clip-padding border-white/20" />
      {/* right sidebar */}
      <button
        className={`group hidden sm:grid fixed right-0 inset-y-0 h-full w-[50vw] duration-300 cursor-pointer place-items-center z-40 border-l ${
          isChatOpen
            ? "bg-[#201633] translate-x-0 opacity-100 border-white/10"
            : "sm:translate-x-[20rem] md:translate-x-[24rem] lg:translate-x-[32rem] xl:translate-x-[40rem] 2xl:translate-x-[48rem] opacity-50 hover:bg-[#201633] bg-clip-padding border-white/20 bg-[repeating-linear-gradient(-45deg,#fff2,#fff2_1px,#fff0_1.5px,#fff0_12px)]"
        }`}
        onClick={() => toggleChat(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            toggleChat(true);
          }
        }}
        tabIndex={0}
        type="button"
      >
        {!isChatOpen && (
          <div className="font-mono absolute xl:w-12 min-[1800px]:w-fit min-[1800px]:flex-nowrap text-center flex flex-wrap justify-center xl:left-[calc((100vw-80rem)/4)] 2xl:left-[calc((100vw-96rem)/4)] top-1/2 -translate-1/2 opacity-0 group-hover:opacity-100 px-1 gap-0.25">
            {"open chat".split("").map((char, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
                key={i}
                className="animate-openchat"
                // per-index delay so animation cascades
                style={{ ["--delay" as any]: `${i * 80}ms` }}
              >
                <span className="relative" aria-hidden>
                  <span className="original inline-block leading-[1]">
                    {char === " " ? "\u00A0" : char}
                  </span>
                  <span
                    className="underscore absolute inset-0 leading-[1]"
                    aria-hidden="true"
                    role="presentation"
                  >
                    _
                  </span>
                </span>
              </span>
            ))}
          </div>
        )}
      </button>
    </>
  );
}
