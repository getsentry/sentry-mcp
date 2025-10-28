import {
  ChartNoAxesCombined,
  Compass,
  LayoutDashboard,
  Settings,
  Shield,
} from "lucide-react";
import { SentryIcon } from "../../ui/icons/sentry";

export default function BrowserWindowIconSidebar() {
  return (
    <div className="flex flex-col gap-3 px-4 pt-2 overflow-clip max-h-full">
      <div className="size-12 flex-shrink-0 rounded-xl border-[0.5px] border-violet-300/20 bg-gradient-to-tr from-[#362e5a] to-[#885091] grid place-content-center text-white bg-clip-padding">
        <SentryIcon className="h-8 w-8 text-white" />
      </div>
      <div className="size-12 flex-shrink-0 rounded-xl border-[0.5px] border-violet-300/20 bg-violet-300/13 grid place-content-center">
        <Compass className="h-8 w-8 stroke-1 text-violet-300" />
      </div>
      <div className="size-12 flex-shrink-0 rounded-xl grid place-content-center opacity-50">
        <LayoutDashboard className="h-8 w-8 stroke-1" />
      </div>
      <div className="size-12 flex-shrink-0 rounded-xl grid place-content-center opacity-50">
        <ChartNoAxesCombined className="h-8 w-8 stroke-1" />
      </div>
      <div className="size-12 flex-shrink-0 rounded-xl grid place-content-center opacity-50">
        <Shield className="h-8 w-8 stroke-1" />
      </div>
      <div className="size-12 flex-shrink-0 rounded-xl grid place-content-center opacity-50">
        <Settings className="h-8 w-8 stroke-1" />
      </div>
    </div>
  );
}
