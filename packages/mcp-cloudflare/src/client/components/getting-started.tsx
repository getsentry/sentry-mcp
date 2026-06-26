import { useSearchParams } from "react-router-dom";
import { Button } from "./ui/button";
import RemoteSetup, { RemoteSetupTabs } from "./fragments/remote-setup";
import StdioSetup, { StdioSetupTabs } from "./fragments/stdio-setup";
import { Cable, Cloud } from "lucide-react";

export default function Integration() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Derive state from query params with defaults
  const stdio = searchParams.get("transport") === "stdio";
  const selectedIde = searchParams.get("ide") || "claude-code";

  const updateParams = (updates: { transport?: string; ide?: string }) => {
    const newParams = new URLSearchParams(searchParams);
    if (updates.transport !== undefined) {
      newParams.set("transport", updates.transport);
    }
    if (updates.ide !== undefined) {
      newParams.set("ide", updates.ide);
    }
    setSearchParams(newParams, { replace: true });
  };

  const setSelectedIde = (ide: string) => updateParams({ ide });
  const setStdio = (isStdio: boolean) =>
    updateParams({ transport: isStdio ? "stdio" : "cloud" });
  return (
    <section
      id="getting-started"
      className="flex flex-col md:max-w-3xl mx-auto relative mb-12 -scroll-mt-8 max-w-full"
    >
      <div className="flex justify-between items-center px-4 sm:px-8 pt-4 sm:pt-8 pb-4">
        <h1 className="text-2xl md:text-2xl font-semibold">Installation</h1>
        <div className="flex items-center text-xs bg-background-3 rounded-xl p-1 size-fit -translate-x-[1.5px] z-20 border-[0.5px] border-violet-300/50 gap-0.5">
          <Button
            variant={!stdio ? "default" : "secondary"}
            size="xs"
            onClick={() => {
              setStdio(false);
              document
                .getElementById("getting-started")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className={`${
              !stdio && "shadow-sm"
            } rounded-lg !pr-3 !pl-2 focus:!ring-violet-300 focus-visible:z-30 focus:ring-offset-1 focus:ring-offset-background-3`}
          >
            <Cloud className="size-4 fill-current" />
            Cloud
          </Button>
          <Button
            variant={stdio ? "default" : "secondary"}
            size="xs"
            onClick={() => {
              setStdio(true);
              document
                .getElementById("getting-started")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className={`${
              stdio && "shadow-sm"
            } rounded-lg !pr-3 !pl-2 focus:!ring-violet-300 focus-visible:z-30 focus:ring-offset-1 focus:ring-offset-background-3`}
          >
            <Cable className="size-4" />
            Stdio
          </Button>
        </div>
      </div>

      {/* Client installation tabs first */}
      <div className="p-4 sm:p-8 pt-0 sm:pt-0 border-b border-dashed border-white/10">
        {!stdio ? (
          <RemoteSetupTabs
            selectedIde={selectedIde}
            onIdeChange={setSelectedIde}
          />
        ) : (
          <StdioSetupTabs
            selectedIde={selectedIde}
            onIdeChange={setSelectedIde}
          />
        )}
      </div>

      <div className="px-4 sm:px-8 pt-4 sm:pt-8 pb-4">
        {/* Advanced options after */}
        <div className="relative min-h-0">
          {!stdio ? (
            <div
              key="cloud"
              className="animate-in fade-in motion-safe:slide-in-from-left-4 duration-300"
            >
              <RemoteSetup />
            </div>
          ) : (
            <div
              key="stdio-self-hosted"
              className="animate-in fade-in motion-safe:slide-in-from-right-4 duration-300"
            >
              <StdioSetup />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
