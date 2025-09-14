import { ChevronDown } from "lucide-react";

export default function IssueDetails({ step }: { step: number }) {
  return (
    <>
      {/*<h1 className="text-2xl font-bold">Zod Error</h1>*/}
      <div
        className={`${
          step === 1 ? "opacity-100" : step > 1 ? "opacity-0" : "opacity-40"
        } rounded-xl border border-white/0 bg-white/0 duration-300`}
        id="stack-trace-container"
      >
        <div className="w-full border-white/5 flex justify-between items-center border-b bg-white/0 p-3">
          Highlights
          <ChevronDown className="h-5 w-5 text-white/50" />
        </div>
        <div className="w-full p-3 flex items-center justify-between">
          Stack Trace
          <ChevronDown className="h-5 w-5 text-white/50 -scale-y-100" />
        </div>
        <div className="relative w-[calc(100%-1rem)] m-2">
          <div
            className={`${
              step >= 1
                ? "-translate-x-[150%] translate-y-1/2 origin-bottom scale-50 opacity-0 delay-675 duration-1000"
                : ""
            } pb-4 rounded-xl border border-white/20 bg-pink-900 text-pink100`}
          >
            <div className="h-full w-full rounded-xl border border-white/20 bg-white/10">
              <pre>
                {`
  Error: Something went wrong
    at main.js:123
    at index.js:456`}
              </pre>
            </div>
          </div>
          <div
            className={`${
              step >= 1
                ? "-translate-x-[150%] translate-y-1/2 origin-bottom scale-0 opacity-0 delay-675 duration-1000"
                : ""
            } absolute top-0 w-full h-32 rounded-xl border border-white/20 bg-white/5`}
          />
          <div
            className={`${
              step >= 1
                ? "-translate-x-[150%] -translate-y-1/2 origin-bottom scale-25 opacity-0 delay-750 duration-1000"
                : ""
            } absolute top-0 w-full h-full rounded-xl border border-white/20 bg-white/5`}
          />
          <div
            className={`${
              step >= 1
                ? "-translate-x-[150%] -translate-y-1/2 origin-bottom scale-33 opacity-0 delay-750 duration-1000"
                : ""
            } absolute top-0 h-full w-full rounded-xl border border-white/20 bg-white/5`}
          />
        </div>
      </div>
    </>
  );
}
