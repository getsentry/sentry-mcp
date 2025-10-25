import BrowserWindow from "./browser-ui/BrowserWindow";
import IDEWindow from "./browser-ui/IDEWindow";
import LoadingSquares from "./browser-ui/LoadingSquares";
import ValidationSummary from "./tests";

export default function BrowserAnimation({
  globalIndex,
}: {
  globalIndex: number;
}) {
  return (
    <div
      className={`relative h-full w-full ${
        globalIndex >= 2 && "overflow-hidden"
      } hidden md:block rounded-3xl bg-dots`}
    >
      <IDEWindow step={globalIndex} />
      <BrowserWindow step={globalIndex} />
      <LoadingSquares step={globalIndex} />
      <ValidationSummary step={globalIndex} />
      {/*<div id="window3-browser" className="absolute flex flex-col pr-1 pb-1 w-full h-full bg-600 rounded-2xl border border-white/10 scale-90 bottom-0 origin-bottom">
      </div>*/}
    </div>
  );
}
