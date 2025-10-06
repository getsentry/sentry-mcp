export default function Copy({ step }: { step?: number }) {
  return (
    <div className="-translate-1/2 absolute top-1/2 left-1/2 z-10 flex items-center gap-3">
      <div
        className={`${
          step === 0 && "animate-keycap"
        } relative size-fit opacity-0 translate-x-8 -translate-y-4`}
        style={{ ["--delay" as any]: "1.00s" }}
      >
        {/* <div className="absolute bottom-0 left-1/2 h-[69%] w-[72.5%] -translate-x-[51%] rotate-x-50 rotate-z-27 rounded-3xl rounded-br-2xl bg-[#160f24] perspective-distant" /> */}
        <div className="[mask-image:url('/keycap-⌘.png')] [mask-size:100%] bg-clip-content size-fit relative [filter:drop-shadow(inset_0_-1rem_1rem_rgba(0,0,0,1))] translate-y-2">
          <div className="absolute bottom-0 left-1/2 h-[69%] w-[72.5%] -translate-x-[51%] rotate-x-50 rotate-z-27 rounded-3xl rounded-br-2xl bg-[#160f24] perspective-distant" />
          <img
            className={`${
              step === 0 && "animate-keycap-inner-meta"
            } bg-clip-content`}
            src="/keycap-⌘.png"
            alt="keycap-⌘"
            style={{ ["--delay" as any]: "1.05s" }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        </div>
      </div>
      <div
        className={`${
          step === 0 && "animate-keycap"
        } relative size-fit opacity-0 -translate-x-8 translate-y-4`}
        style={{ ["--delay" as any]: "1.15s" }}
      >
        {/* <div className="absolute bottom-0 left-1/2 h-[69%] w-[72.5%] -translate-x-[51%] rotate-x-50 rotate-z-27 rounded-3xl rounded-br-2xl bg-[#160f24] perspective-distant" /> */}
        <div className="[mask-image:url('/keycap-c.png')] [mask-size:100%] bg-clip-content size-fit relative [filter:drop-shadow(inset_0_-1rem_1rem_rgba(0,0,0,1))] translate-y-2">
          <div className="absolute bottom-0 left-1/2 h-[69%] w-[72.5%] -translate-x-[51%] rotate-x-50 rotate-z-27 rounded-3xl rounded-br-2xl bg-[#160f24] perspective-distant" />
          <img
            className={`${
              step === 0 && "animate-keycap-inner"
            } bg-clip-content`}
            src="/keycap-c.png"
            alt="keycap-c"
            style={{ ["--delay" as any]: "1.30s" }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        </div>
      </div>
    </div>
  );
}
