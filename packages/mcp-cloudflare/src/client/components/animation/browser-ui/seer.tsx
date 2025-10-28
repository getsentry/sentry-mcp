import { useId } from "react";
import RootCause from "./RootCause";

export default function Seer({ step }: { step: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <div
      className={`${
        step === 2
          ? "scale-100 opacity-100 duration-300"
          : "scale-90 opacity-0 pointer-events-none"
      } absolute overflow-hidden top-0 right-0 z-10 h-full w-full bg-600 flex flex-col justify-center p-4 pr-16 pb-16 ease-out`}
    >
      <div
        className={`inset-0 absolute bg-[#160f24] rounded-tl-xl rounded-br-3xl border-t border-l border-white/20 ${
          step === 2
            ? "duration-300 opacity-80 translate-x-0 blur-none"
            : "duration-0 opacity-0 motion-safe:translate-x-1/2 blur-xl"
        }`}
      />
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
              className={`mx-auto h-8 w-8 translate-y-1/2 rounded-full bg-blue-700 ${
                step === 2
                  ? "translate-x-6 delay-1200 duration-1500"
                  : "-translate-x-6"
              }`}
            />
          </div>
        </div>
      </div>

      <RootCause step={step} />
    </div>
  );
}
