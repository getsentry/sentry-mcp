import {
  ChartNoAxesCombined,
  Compass,
  LayoutDashboard,
  Settings,
  Shield,
} from "lucide-react";
import { SentryIcon } from "../../ui/icons/sentry";
import Copy from "./Copy";
import IssueDetails from "./IssueDetails";
import Seer from "./👀";
import WindowHeader from "./WindowHeader";

export default function BrowserWindow({ step }: { step: number }) {
  return (
    <div
      className={`${
        step >= 3
          ? "pointer-events-none translate-x-32 scale-75 opacity-0 blur-xl"
          : step === 1
            ? "border-pink-400/50"
            : step === 2
              ? "border-orange-400/50"
              : "border-white/10"
      } absolute inset-0 flex h-full w-full flex-col rounded-3xl border bg-white/5 duration-300 backdrop-blur-3xl`}
      id="window"
    >
      <Copy step={step} />
      <WindowHeader step={step} />
      <div className={`flex h-full w-full ${step > 1 && "overflow-hidden"}`}>
        <div className="flex flex-col gap-3 px-4 pt-2 overflow-clip max-h-full">
          <div className="size-12 flex-shrink-0 rounded-xl border border-white/20 bg-gradient-to-tr from-[#362e5a] to-[#885091] grid place-content-center text-white">
            <SentryIcon className="h-8 w-8 text-white" />
          </div>
          <div className="size-12 flex-shrink-0 rounded-xl border border-white/20 bg-white/13 grid place-content-center">
            <Compass className="h-8 w-8 stroke-1" />
          </div>
          <div className="size-12 flex-shrink-0 rounded-xl border border-white/20 bg-white/11 grid place-content-center">
            <LayoutDashboard className="h-8 w-8 stroke-1" />
          </div>
          <div className="size-12 flex-shrink-0 rounded-xl border border-white/20 bg-white/9 grid place-content-center">
            <ChartNoAxesCombined className="h-8 w-8 stroke-1" />
          </div>
          <div className="size-12 flex-shrink-0 rounded-xl border border-white/20 bg-white/6 grid place-content-center">
            <Shield className="h-8 w-8 stroke-1" />
          </div>
          <div className="size-12 flex-shrink-0 rounded-xl border border-white/20 bg-white/3 grid place-content-center">
            <Settings className="h-8 w-8 stroke-1" />
          </div>
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
