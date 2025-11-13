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
    <div className="relative h-full w-full hidden md:block bg-dots bg-fixed">
      <IDEWindow step={globalIndex} />
      <BrowserWindow step={globalIndex} />
      <LoadingSquares step={globalIndex} />
      <ValidationSummary step={globalIndex} />
    </div>
  );
}
