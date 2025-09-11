import Copy from "./Copy";
import IssueDetails from "./IssueDetails";
import Seer from "./Seer";
import WindowHeader from "./WindowHeader";

export default function BrowserWindow({ step }: { step: number }) {
  return (
    <div
      className={`${
        step >= 3
          ? "pointer-events-none translate-x-32 scale-75 opacity-0 blur-xl"
          : ""
      } absolute bottom-2.5 flex h-[calc(100%-0.625rem)] w-full flex-col rounded-2xl border border-white/10 bg-white/5 duration-300`}
      id="window"
    >
      <Copy />
      <WindowHeader />
      <div className="flex h-full w-full overflow-hidden">
        <div className="flex flex-col gap-3 px-4 pt-2 overflow-clip max-h-full">
          <div className="size-12 flex-shrink-0 rounded-xl border border-white/20 bg-white/35" />
          <div className="size-12 flex-shrink-0 rounded-xl border border-white/20 bg-white/10" />
          <div className="size-12 flex-shrink-0 rounded-xl border border-white/20 bg-white/10" />
          <div className="size-12 flex-shrink-0 rounded-xl border border-white/20 bg-white/10" />
          {/* <div className="size-12 flex-shrink-0 rounded-xl border border-white/20 bg-white/10" />
          <div className="size-12 flex-shrink-0 rounded-xl border border-white/20 bg-white/10" /> */}
          <div className="size-12 flex-shrink-0 rounded-xl border border-white/20 bg-white/5" />
        </div>
        {/* WINDOW CONTENTS */}
        <div
          className={`relative flex w-full flex-col gap-3 p-0 ${
            step === 2 && "overflow-hidden"
          }`}
        >
          <IssueDetails step={step} />
          {/* seer drawer */}
          <Seer step={step} />
        </div>
      </div>
    </div>
  );
}
