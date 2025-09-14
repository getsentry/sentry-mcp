import { CheckCheck } from "lucide-react";
import { useEffect } from "react";
import BrowserWindow from "./browser-ui/BrowserWindow";
import IDEWindow from "./browser-ui/IDEWindow";

export default function BrowserAnimation({
  globalIndex,
}: {
  globalIndex: number;
}) {
  useEffect(() => {
    runAnimationFor(globalIndex);
  }, [globalIndex]);

  function runAnimationFor(index: number) {
    if (index === 0) {
      // 1) URL: simulate hover+click and text selection immediately
      const urlEl = document.getElementById("url");
      if (urlEl) {
        // retriggerable: remove -> reflow -> add
        urlEl.classList.remove("animate-url");
        // void (urlEl as HTMLElement).offsetWidth;
        urlEl.classList.add("animate-url");
        const sel = window.getSelection();
        // TODO: simulated SELECT HIGHLIGHT
      }

      // 2) KEYCAPS: trigger your existing keycap animation class on all .keycap
      const keycaps =
        document.querySelectorAll<HTMLDivElement>("#demo .keycap");

      // re-triggerable: remove -> reflow -> add
      for (const el of keycaps) {
        el.classList.remove("animate-keycap");
        // void el.offsetWidth; // force reflow so animation restarts cleanly
        el.classList.add("animate-keycap");
      }
    }
  }

  return (
    <div
      className={`relative h-full w-full ${
        globalIndex >= 2 && "overflow-hidden"
      } hidden md:block`}
    >
      <IDEWindow step={globalIndex} />
      <BrowserWindow step={globalIndex} />
      <div
        className={`flex h-full items-center justify-center ${
          globalIndex === 5
            ? "scale-100 opacity-100 blur-none delay-200 duration-500"
            : "scale-0 opacity-0 blur-xl"
        } pointer-events-none absolute top-0 left-0 w-full transition-all`}
      >
        <div
          className={`rounded-full bg-gradient-to-br from-lime-400 to-lime-950 p-6 ${
            globalIndex === 5 ? "scale-50 delay-1000 duration-500" : "scale-100"
          } origin-top-left`}
        >
          <CheckCheck
            className={`size-20 text-white/50 ${
              globalIndex === 5
                ? "scale-100 opacity-100 blur-none delay-200 duration-500"
                : "scale-0 opacity-0 blur-xl"
            }`}
          />
        </div>
      </div>
      {/*<div id="window3-browser" className="absolute flex flex-col pr-1 pb-1 w-full h-full bg-600 rounded-2xl border border-white/10 scale-90 bottom-0 origin-bottom">
      </div>*/}
    </div>
  );
}
