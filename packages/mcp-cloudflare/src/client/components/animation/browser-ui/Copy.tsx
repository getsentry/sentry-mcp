export default function Copy() {
  return (
    <div className="-translate-1/2 absolute top-1/2 left-1/2 z-10 flex items-center gap-3">
      <div
        className="keycap grid size-24 place-items-center rounded-2xl border border-white/30 bg-violet-300 font-bold text-5xl text-background opacity-0 shadow-xl"
        style={{ ["--delay" as any]: "1.00s" }}
      >
        ⌘
      </div>
      {/*<Plus />*/}
      <div
        className="keycap grid size-24 place-items-center rounded-2xl border border-white/30 bg-violet-300 font-bold text-4xl text-background opacity-0 shadow-xl"
        style={{ ["--delay" as any]: "1.15s" }}
      >
        C
      </div>
    </div>
  );
}
