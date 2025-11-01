import { Maximize } from "lucide-react";
import { CheckCheck } from "lucide-react";

export default function ValidationSummary({ step }: { step?: number }) {
  return (
    <div
      className={`flex flex-col h-full mx-auto w-fit justify-center ${
        step === 5
          ? "scale-100 opacity-100 blur-none delay-200 duration-500"
          : "scale-0 opacity-0 blur-xl"
      } pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 transition-all gap-8`}
    >
      <div className="flex items-center gap-6 text-2xl font-bold font-mono relative">
        <div
          className={`rounded-lg absolute left-0 inset-y-0 size-16 bg-lime-200 bg-[repeating-linear-gradient(45deg,#0008,#0008_4px,#0004_4px,#0004_10px)] scale-95 ${
            step === 5
              ? "opacity-100 delay-1000 duration-500 translate-2"
              : "opacity-0"
          }`}
        />
        <div
          className={`rounded-lg relative bg-gradient-to-br from-lime-900 to-lime-950 p-3 ${
            step === 5
              ? "scale-100 delay-1000 duration-500"
              : "motion-safe:scale-200"
          } origin-top-left`}
        >
          <Maximize
            className={`absolute -inset-2 size-[125%] stroke-lime-200/50 stroke-[0.5px] ${
              step === 5
                ? "scale-100 opacity-100 delay-700 duration-500"
                : "scale-75 opacity-0"
            }`}
          />
          <CheckCheck
            className={`size-10 text-lime-200 ${
              step === 5
                ? "scale-100 opacity-100 blur-none delay-200 duration-500"
                : "scale-0 opacity-0 blur-xl"
            }`}
          />
        </div>
        <span
          className={`${
            step === 5
              ? "opacity-100 translate-x-0 duration-300 delay-1250"
              : "opacity-0 motion-safe-translate-x-4"
          } transition-all`}
        >
          <span className="opacity-50">pnpm run</span> tsc
        </span>
      </div>
      <div className="flex items-center gap-6 text-2xl font-bold font-mono relative">
        <div
          className={`rounded-lg absolute left-0 inset-y-0 size-16 bg-lime-200 bg-[repeating-linear-gradient(45deg,#0008,#0008_4px,#0004_4px,#0004_10px)] scale-95 ${
            step === 5
              ? "opacity-100 delay-1200 duration-500 translate-2"
              : "opacity-0"
          }`}
        />
        <div
          className={`rounded-lg relative bg-gradient-to-br from-lime-900 to-lime-950 p-3 ${
            step === 5 ? "opacity-100 delay-1200 duration-500" : "opacity-0"
          }`}
        >
          <Maximize
            className={`absolute -inset-2 size-[125%] stroke-lime-200/50 stroke-[0.5px] ${
              step === 5
                ? "scale-100 opacity-100 delay-1200 duration-500"
                : "scale-75 opacity-0"
            }`}
          />
          <CheckCheck
            className={`size-10 text-lime-200 ${
              step === 5
                ? "scale-100 opacity-100 blur-none delay-200 duration-500"
                : "scale-0 opacity-0 blur-xl"
            }`}
          />
        </div>
        <span
          className={`${
            step === 5
              ? "opacity-100 translate-x-0 duration-300 delay-1450"
              : "opacity-0 motion-safe:-translate-x-4"
          } transition-all`}
        >
          <span className="opacity-50">pnpm run</span> lint
        </span>
      </div>
      <div className="flex items-center gap-6 text-2xl font-bold font-mono relative">
        <div
          className={`rounded-lg absolute left-0 inset-y-0 size-16 bg-lime-200 bg-[repeating-linear-gradient(45deg,#0008,#0008_4px,#0004_4px,#0004_10px)] scale-95 ${
            step === 5
              ? "opacity-100 delay-1400 duration-500 translate-2"
              : "opacity-0"
          }`}
        />
        <div
          className={`rounded-lg relative bg-gradient-to-br from-lime-900 to-lime-950 p-3 ${
            step === 5 ? "opacity-100 delay-1400 duration-500" : "opacity-0"
          }`}
        >
          <Maximize
            className={`absolute -inset-2 size-[125%] stroke-lime-200/50 stroke-[0.5px] ${
              step === 5
                ? "scale-100 opacity-100 delay-1400 duration-500"
                : "scale-75 opacity-0"
            }`}
          />
          <CheckCheck
            className={`size-10 text-lime-200 ${
              step === 5
                ? "scale-100 opacity-100 blur-none delay-200 duration-500"
                : "scale-0 opacity-0 blur-xl"
            }`}
          />
        </div>
        <span
          className={`${
            step === 5
              ? "opacity-100 translate-x-0 duration-300 delay-1750"
              : "opacity-0 motion-safe:-translate-x-4"
          } transition-all`}
        >
          <span className="opacity-50">pnpm run</span> tests
        </span>
      </div>
    </div>
  );
}
