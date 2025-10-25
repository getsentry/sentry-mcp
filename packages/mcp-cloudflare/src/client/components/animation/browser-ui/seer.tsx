
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
      } absolute top-0 right-0 z-10 h-full w-full bg-600 flex flex-col justify-center p-4 pr-16 pb-16 ease-out`}
    >
      {/* <div className="-z-10 absolute inset-0 bg-grid opacity-50 [mask-image:linear-gradient(to_bottom,transparent,red,transparent),linear-gradient(to_right,transparent,red,transparent)] [mask-composite:intersect]" /> */}
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
              className={`mx-auto h-8 w-8 translate-y-1/2 rounded-full bg-blue-700 delay-900 duration-1500 ${
                step === 2 ? "translate-x-6" : "-translate-x-6"
              }`}
            />
          </div>
        </div>
      </div>

      <RootCause step={step} />
    </div>
  );
}
