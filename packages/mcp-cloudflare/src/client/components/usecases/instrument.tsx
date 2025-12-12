import { ChartSpline, Hammer, Shield } from "lucide-react";
import { SentryIcon } from "../ui/icons/sentry";

export default function Instrument() {
  return (
    <div
      id="connector"
      className="group relative p-4 sm:p-8 lg:max-xl:border-r border-b border-dashed border-white/10 overflow-hidden justify-end flex flex-col"
    >
      <div className="absolute inset-0 pointer-events-none bg-dots [--size:1rem] group-hover:opacity-50 opacity-30 duration-300 -z-20" />
      <div className="px-12 p-6 mb-auto">
        <div className="flex w-full">
          <div className="rounded-full size-12 my-auto border border-white/20 group-hover:border-white/20 duration-300 border-dashed bg-background-2 group-hover:bg-white relative">
            <div className="absolute top-1/2 left-1/2 -translate-1/2 size-24 scale-50 group-hover:scale-100 duration-500 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] bg-pink-300/20 rounded-full opacity-0 group-hover:opacity-100 -z-10 border border-select/40" />
            <div className="absolute top-1/2 left-1/2 -translate-1/2 size-36 scale-50 group-hover:scale-100 duration-500 group-hover:delay-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] bg-purple-400/20 rounded-full opacity-0 group-hover:opacity-100 -z-10 border border-dashed border-purple-400/40" />
          </div>

          <div className="relative flex-1">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full block"
              aria-hidden="true"
            >
              {[
                {
                  endY: 25,
                  color: "text-white/30 group-hover:text-white",
                },
                {
                  endY: 50,
                  color: "text-fuchsia-200/40 group-hover:text-select/80",
                },
                {
                  endY: 75,
                  color: "text-purple-200/50 group-hover:text-purple-400/80",
                },
              ].map(({ endY, color }, i) => {
                // All start from one point (0,50) and diverge rightward with wavy curves.
                const d = `
      M 0 50
      C 15 ${45 + (i - 1) * 8},
        25 ${55 - (i - 1) * 10},
        40 ${45 + (i - 1) * 12}
      S 70 ${55 - (i - 1) * 14},
        100 ${endY}
    `;

                return (
                  <path
                    // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
                    key={i}
                    d={d}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1}
                    strokeLinecap="round"
                    strokeDasharray="8 8"
                    strokeDashoffset={0}
                    vectorEffect="non-scaling-stroke"
                    className={color}
                  >
                    {/* Right-to-left motion (increase offset) */}
                    <animate
                      attributeName="stroke-dashoffset"
                      from="0"
                      to="160"
                      dur="1.2s"
                      begin="connector.mouseover"
                      end="connector.mouseout"
                      repeatCount="indefinite"
                    />
                  </path>
                );
              })}
            </svg>
          </div>

          <div className="flex flex-col gap-6 justify-center">
            <div className="size-12 rounded-xl bg-white relative">
              <div className="inset-0 size-full absolute grid place-items-center border border-white/20 border-dashed bg-background-2 rounded-xl duration-300 group-hover:border-white/80 group-hover:-translate-y-1 group-hover:ease-[cubic-bezier(0.175,0.885,0.32,1.275)]">
                <SentryIcon className="h-8 w-8 duration-150 group-hover:opacity-100 opacity-50" />
              </div>
            </div>
            <div className="size-12 rounded-xl bg-select relative">
              <div className="inset-0 size-full absolute border border-white/20 border-dashed bg-background-2 rounded-xl duration-300 group-hover:-translate-y-1 group-hover:ease-[cubic-bezier(0.175,0.885,0.32,1.275)] grid place-items-center group-hover:delay-200 group-hover:border-select/80">
                <ChartSpline className="h-8 w-8 duration-150 group-hover:delay-200 group-hover:opacity-100 group-hover:text-select/80 opacity-50" />
              </div>
            </div>
            <div className="size-12 rounded-xl relative bg-purple-400">
              <div className="inset-0 size-full absolute border border-white/20 border-dashed bg-background-2 rounded-xl group-hover:-translate-y-1 group-hover:ease-[cubic-bezier(0.175,0.885,0.32,1.275)] grid place-items-center group-hover:delay-400 duration-300 group-hover:border-purple-400/80">
                <Shield className="h-8 w-8 duration-150 group-hover:delay-400 group-hover:opacity-100 group-hover:text-purple-400/80 opacity-50" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex">
        <div className="flex flex-col">
          <h3 className="md:text-xl font-bold">Instrument Your App</h3>
          <p className="text-balance text-white/70">
            Teach your app to overshare. Traces, metrics, errors—finally all
            gossiping in one place.
          </p>
        </div>
        <Hammer className="size-16 ml-auto text-white/20 group-hover:text-white/40 stroke-[0.5px] duration-300 mt-auto" />
      </div>
    </div>
  );
}
