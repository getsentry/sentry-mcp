import { Maximize, Plus, ScanEye, ScanSearch } from "lucide-react";
import { useId } from "react";

export default function Seer({ step }: { step: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <div
      className={`${
        step === 2
          ? "scale-100 opacity-100 duration-300"
          : "scale-90 opacity-0 pointer-events-none"
      } absolute top-0 right-0 z-10 h-full w-full bg-600 flex flex-col justify-center p-4 pr-16 pb-16 ease-out`}
    >
      <div className="-z-10 absolute inset-0 bg-grid [mask-image:linear-gradient(to_bottom,transparent,red,transparent),linear-gradient(to_right,transparent,red,transparent)] [mask-composite:intersect]" />
      {/* <h1 className="font-bold text-2xl">👀 Seer</h1> */}
      {/*<!-- Seer's triangles scalable clipPath mask -->*/}
      <svg className="absolute" height="0" width="0">
        <title>Seer's Triangle</title>
        <defs>
          <clipPath clipPathUnits="objectBoundingBox" id={id}>
            <path d="M0.5 0 A2.5 2.5 0 0 1 1 0.866025 A2.5 2.5 0 0 1 0 0.866025 A2.5 2.5 0 0 1 0.5 0 Z" />
          </clipPath>
        </defs>
      </svg>
      {/* ⚠️ Seer */}
      <div
        className="relative z-10 mx-auto aspect-square w-36 overflow-hidden bg-gradient-to-b from-pink-600 to-pink-400"
        style={{
          clipPath: `url(#${id})`,
        }}
      >
        <div className="bg-pink-300 [mask-image:linear-gradient(to_top,red,transparent)] absolute inset-0 [filter:url(#nnnoise-darken-fine)]" />
        {/* eye mask */}
        <div className="-translate-x-1/2 absolute left-1/2 mt-16 w-full shadow-2xl shadow-amber-500 [mask-image:radial-gradient(ellipse_100%_200%_at_top,red_50%,transparent_50%)]">
          <div className="bg-amber-100 [mask-image:radial-gradient(ellipse_at_bottom,red_50%,transparent_50%)]">
            {/* 👁️ Eye of the Seer */}
            <div
              className={`mx-auto h-8 w-8 translate-y-1/2 rounded-full bg-blue-700 delay-300 duration-1000 ${
                step === 2 ? "translate-x-6" : "-translate-x-6"
              }`}
            />
          </div>
        </div>
      </div>
      <div className="mt-6 mb-12 text-2xl 2xl:text-4xl font-semibold font-sans text-white flex items-center justify-center">
        <div className="relative mr-2 text-violet-300 font-bold">
          <span
            className={`${
              step === 2 &&
              "delay-[1.5s] duration-300 translate-y-1/2 opacity-0 scale-90 blur-xl"
            }`}
          >
            Seeking
          </span>
          <span
            className={`absolute right-0 ${
              step === 2
                ? "delay-[1.65s] duration-300 translate-y-0 opacity-100 scale-100 blur-none"
                : "-translate-y-1/2 opacity-0 scale-90 blur-xl"
            }`}
          >
            Found
          </span>
        </div>{" "}
        the Root Cause
        <div className="relative">
          <span
            className={`${
              step === 2 &&
              "delay-[1.5s] duration-300 -translate-y-1/2 opacity-0 scale-90 blur-xl"
            }`}
          >
            ...
          </span>
          <span
            className={`absolute inset-0 ${
              step === 2
                ? "delay-[1.65s] duration-300 translate-y-0 opacity-100 scale-100 blur-none"
                : "translate-y-1/2 opacity-0 scale-90 blur-xl"
            }`}
          >
            !
          </span>
        </div>
      </div>
      {/* 🛑 Root Cause */}
      <div
        className={`${
          step === 2
            ? "border-orange-300/40 bg-orange-500/20 delay-1000 duration-300"
            : "border-orange-300/20 bg-orange-500/10"
        } group relative mx-auto size-32 rounded-xl border`}
      >
        {/*<div className="relative">*/}
        <Plus
          className={`absolute inset-0 m-auto size-8 rotate-45 stroke-1 stroke-white opacity-0 delay-150 duration-500 ${
            step === 2 && "rotate-135 opacity-100 delay-1000 duration-200"
          }`}
        />
        <div className="-translate-1/2 absolute top-1/2 left-1/2">
          <div
            className={`-rotate-45 h-8 border-white border-r ${
              step === 2
                ? "translate-16 opacity-100 delay-1200 duration-200"
                : "translate-24 opacity-0"
            }`}
          />
        </div>
        <div className="-translate-1/2 absolute top-1/2 left-1/2">
          <div
            className={`-rotate-45 h-8 border-white border-r ${
              step === 2
                ? "-translate-16 opacity-100 delay-1200 duration-200"
                : "-translate-24 opacity-0"
            }`}
          />
        </div>
        <div className="-translate-1/2 absolute top-1/2 left-1/2">
          <div
            className={`h-8 rotate-45 border-white border-r ${
              step === 2
                ? "-translate-y-16 translate-x-16 opacity-100 delay-1200 duration-200"
                : "-translate-y-24 translate-x-24 opacity-0"
            }`}
          />
        </div>
        <div className="-translate-1/2 absolute top-1/2 left-1/2">
          <div
            className={`h-8 rotate-45 border-white border-r ${
              step === 2
                ? "-translate-x-16 translate-y-16 opacity-100 delay-1200 duration-200"
                : "-translate-x-24 translate-y-24 opacity-0"
            }`}
          />
        </div>
        <ScanSearch
          className={`${
            step === 2 && "-translate-y-24 duration-2000"
          } -translate-x-20 absolute stroke-1 bottom-8 left-0 size-8 text-orange-400`}
        />
        <ScanEye
          className={`${
            step === 2 && "translate-y-24 duration-2000"
          } absolute stroke-1 top-8 right-0 size-8 translate-x-20 text-orange-400`}
        />
        <Maximize
          className={`absolute ${
            step === 2 ? "scale-90 delay-1000 duration-300" : "scale-110"
          } -translate-1/2 top-1/2 left-1/2 size-48 stroke-[0.25px] text-orange-400 ease-[cubic-bezier(0.25,0.1,0.25,1)]`}
        />
      </div>
    </div>
  );
}
