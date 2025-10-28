import BrowserWindowIconSidebar from "./BrowserWindowIconSidebar";
import KeysCopy from "./keys-copy";
import IssueDetails from "./IssueDetails";
import Seer from "./seer";
import WindowHeader from "./WindowHeader";

export default function BrowserWindow({ step }: { step: number }) {
  return (
    <div
      // isometric option: rotate-x-60 -rotate-z-45 scale-75 perspective-distant
      className={`${
        step >= 3
          ? "pointer-events-none motion-safe:translate-x-32 motion-safe:scale-75 opacity-0 blur-xl"
          : step === 1
            ? "border-orange-400/50"
            : step === 2
              ? "border-pink-400/50"
              : "border-white/10"
      } absolute inset-0 flex h-full w-full flex-col rounded-3xl border bg-white/5 duration-300 backdrop-blur-3xl`}
      id="window"
    >
      <KeysCopy step={step} />
      <WindowHeader step={step} />
      <div className={`flex h-full w-full ${step > 1 && "overflow-hidden"}`}>
        <BrowserWindowIconSidebar />
        <div
          className={`relative flex w-full flex-col gap-3 p-0 ${
            step === 2 && "overflow-hidden"
          }`}
        >
          <IssueDetails step={step} />
          <Seer step={step} />
        </div>
      </div>
    </div>
  );
}
