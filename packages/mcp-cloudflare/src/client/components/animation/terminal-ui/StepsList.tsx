"use client";
import { BookCheck, User } from "lucide-react";
import type { Step } from "../TerminalAnimation";

export default function StepsList({
  steps,
  globalIndex,
  onSelectAction,
  className = "",
}: {
  steps: Step[];
  globalIndex: number;
  onSelectAction: (index: number) => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col justify-center group-hover/griditem:!transform-none gap-1 max-md:!transform-none duration-500 ${className}`}
      style={
        {
          // transform: `translateY(${17.5 * (3.5 - globalIndex - 1)}%)`,
        }
      }
    >
      {/* 3.5 = 7/2 (center of 7 steps) */}
      {/* 17.5 is what each step is transitioned by below for stacking */}
      {steps.map((step, idx) => {
        const isActive = idx === globalIndex;
        return (
          <button
            aria-current={isActive ? "step" : undefined}
            className={`group flex cursor-pointer flex-col group-hover/griditem:!transform-none group-hover/griditem:!z-0 group-hover/griditem:!opacity-100  max-md:!transform-none max-md:!z-0 max-md:!opacity-100 overflow-hidden rounded-xl border p-2 pb-0 text-left duration-500 hover:duration-75 backdrop-blur-xl
            ${
              isActive
                ? "border-violet-300/30 bg-gradient-to-r from-transparent to-violet-500/50 text-white"
                : "border-white/15 bg-white/5 hover:bg-white/15"
            }`}
            style={{
              opacity:
                globalIndex !== idx ? 1 - 0.3 * Math.abs(globalIndex - idx) : 1,
              transform:
                globalIndex !== idx
                  ? `scale(${
                      1 - 0.05 * Math.abs(globalIndex - idx)
                    }) translateY(${
                      (globalIndex > idx ? 1 : -1) *
                      17.5 *
                      (globalIndex - idx) *
                      (globalIndex - idx)
                    }%)`
                  : "translateY(0) scale(1)",
              zIndex: isActive ? 10 : Math.abs(globalIndex - idx) * -1,
            }}
            key={step.label}
            onClick={() => onSelectAction(idx)}
            type="button"
          >
            <div className="flex items-center gap-3 pb-2">
              {isActive ? (
                <>
                  <div className="-ml-3 h-6 w-2 animate-ping rounded-r-3xl bg-lime-300" />
                  <div className="-ml-5 mr-1.5 h-8 w-2 rounded-r-3xl bg-lime-500" />
                  <span className="font-mono h-8 flex items-center text-sm opacity-50">
                    {idx === 0 ? (
                      <User className="size-4" />
                    ) : idx > 4 ? (
                      <BookCheck className="size-4" />
                    ) : (
                      step.type
                    )}
                  </span>
                </>
              ) : (
                <>
                  <span className="font-mono flex items-center h-8 text-sm opacity-50 ml-3.5">
                    {idx === 0 ? (
                      <User className="size-4" />
                    ) : idx > 4 ? (
                      <BookCheck className="size-4" />
                    ) : (
                      step.type
                    )}
                  </span>
                  <span className="float-left opacity-0 duration-200 ease-[cubic-bezier(0.64,0.57,0.67,1.53)] group-hover:translate-x-4 group-hover:opacity-100 -ml-4 group-hover:duration-75 max-sm:hidden">
                    →
                  </span>
                </>
              )}
              <span
                className={`inline-block duration-200 ease-[cubic-bezier(0.64,0.57,0.67,1.53)] ${
                  !isActive &&
                  "group-hover:translate-x-4 group-hover:duration-75"
                } max-sm:contents`}
              >
                {step.label}
              </span>
            </div>
            <div
              className={`grid ${
                isActive
                  ? "-mt-1 grid-rows-[1fr] opacity-100"
                  : "mt-0 grid-rows-[0fr] opacity-0"
              } transition-all duration-500 ease-out-expo`}
            >
              <div className="overflow-hidden">
                <p
                  className={`${
                    isActive
                      ? "translate-y-0 scale-100 opacity-100"
                      : "translate-y-10 scale-96 opacity-0"
                  } px-4 pb-3 text-copy-lg text-white/50 transition-all duration-500 ease-out-cubic`}
                >
                  {step.description}
                </p>
              </div>
            </div>
          </button>
        );
      })}
      {/* <button
        className="border group/next my-auto bg-[#201633] border-white/10 size-12 rounded-full grid place-items-center text-left text-white/50 opacity-50 active:duration-75 cursor-pointer active:bg-background hover:opacity-100 active:scale-90 duration-300"
        tabIndex={0}
        type="button"
        onClick={() =>
          onSelectAction(Math.min(globalIndex + 1, steps.length - 1))
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            onSelectAction(Math.min(globalIndex + 1, steps.length - 1));
          }
        }}
      >
        <ChevronRight className="size-6 group-active/next:scale-y-75 group-active/next:translate-x-2 group-active/next:duration-75 duration-300" />
      </button> */}
    </div>
  );
}
