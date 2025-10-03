import { CheckCheck } from "lucide-react";
import BrowserWindow from "./browser-ui/BrowserWindow";
import IDEWindow from "./browser-ui/IDEWindow";

export default function BrowserAnimation({
  globalIndex,
}: {
  globalIndex: number;
}) {
  return (
    <div
      className={`relative h-full w-full ${
        globalIndex >= 2 && "overflow-hidden"
      } hidden md:block rounded-3xl`}
    >
      <IDEWindow step={globalIndex} />
      <BrowserWindow step={globalIndex} />
      <div
        className={`flex flex-col h-full mx-auto w-fit justify-center ${
          globalIndex === 5
            ? "scale-100 opacity-100 blur-none delay-200 duration-500"
            : "scale-0 opacity-0 blur-xl"
        } pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 transition-all gap-8`}
      >
        <div className="flex items-center gap-6 text-2xl font-bold font-mono">
          <div
            className={`rounded-full bg-gradient-to-br from-lime-400 to-lime-950 p-3 ${
              globalIndex === 5
                ? "scale-100 delay-1000 duration-500"
                : "scale-200"
            } origin-top-left`}
          >
            <CheckCheck
              className={`size-10 text-white/50 ${
                globalIndex === 5
                  ? "scale-100 opacity-100 blur-none delay-200 duration-500"
                  : "scale-0 opacity-0 blur-xl"
              }`}
            />
          </div>
          <span
            className={`${
              globalIndex === 5
                ? "opacity-100 translate-x-0 duration-300 delay-1500"
                : "opacity-0 translate-x-4"
            } transition-all`}
          >
            pnpm run tsc
          </span>
        </div>
        <div className="flex items-center gap-6 text-2xl font-bold font-mono">
          <div
            className={`rounded-full bg-gradient-to-br from-lime-400 to-lime-950 p-3 ${
              globalIndex === 5
                ? "opacity-100 delay-1200 duration-500"
                : "opacity-0"
            }`}
          >
            <CheckCheck
              className={`size-10 text-white/50 ${
                globalIndex === 5
                  ? "scale-100 opacity-100 blur-none delay-200 duration-500"
                  : "scale-0 opacity-0 blur-xl"
              }`}
            />
          </div>
          <span
            className={`${
              globalIndex === 5
                ? "opacity-100 translate-x-0 duration-300 delay-1700"
                : "opacity-0 translate-x-4"
            } transition-all`}
          >
            pnpm run lint
          </span>
        </div>
        <div className="flex items-center gap-6 text-2xl font-bold font-mono">
          <div
            className={`rounded-full bg-gradient-to-br from-lime-400 to-lime-950 p-3 ${
              globalIndex === 5
                ? "opacity-100 delay-1400 duration-500"
                : "opacity-0"
            }`}
          >
            <CheckCheck
              className={`size-10 text-white/50 ${
                globalIndex === 5
                  ? "scale-100 opacity-100 blur-none delay-200 duration-500"
                  : "scale-0 opacity-0 blur-xl"
              }`}
            />
          </div>
          <span
            className={`${
              globalIndex === 5
                ? "opacity-100 translate-x-0 duration-300 delay-2000"
                : "opacity-0 translate-x-4"
            } transition-all`}
          >
            pnpm run tests
          </span>
        </div>
      </div>
      {/*<div id="window3-browser" className="absolute flex flex-col pr-1 pb-1 w-full h-full bg-600 rounded-2xl border border-white/10 scale-90 bottom-0 origin-bottom">
      </div>*/}
    </div>
  );
}
