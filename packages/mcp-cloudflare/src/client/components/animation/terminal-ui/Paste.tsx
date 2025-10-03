export default function Paste({ step }: { step?: number }) {
  return (
    <div className="-translate-1/2 absolute top-1/2 left-1/2 z-50 hidden items-center gap-3 md:flex">
      <div
        className={`${
          step === 0 && "animate-keycap"
        } grid size-24 place-items-center rounded-2xl border border-white/20 bg-violet-300 font-bold text-5xl text-background opacity-0`}
        style={{ ["--delay" as any]: "1.75s" }}
      >
        ⌘
      </div>
      {/*<Plus />*/}
      <div
        className={`${
          step === 0 && "animate-keycap"
        } grid size-24 place-items-center rounded-2xl border border-white/20 bg-violet-300 font-bold text-4xl text-background opacity-0`}
        style={{ ["--delay" as any]: "2.00s" }}
      >
        V
      </div>
    </div>
  );
}
