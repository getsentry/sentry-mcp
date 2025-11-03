import { Button } from "./ui/button";
import { Prose } from "./ui/prose";
import { useState } from "react";
import RemoteSetup, { RemoteSetupTabs } from "./fragments/remote-setup";
import StdioSetup, { StdioSetupTabs } from "./fragments/stdio-setup";
import { Cable, Cloud } from "lucide-react";

export default function Integration() {
  const [stdio, setStdio] = useState(false);
  return (
    <section
      id="getting-started"
      className="flex flex-col lg:grid lg:grid-cols-2 md:container mx-auto relative mb-12 -scroll-mt-8 border-b border-dashed border-white/20 max-w-full duration-300 will-change-contents"
    >
      <div className="absolute inset-0 h-full w-full flex justify-end flex-col p-8">
        <div className="flex items-center text-xs bg-background-3 rounded-full p-1 sticky bottom-4 size-fit -translate-x-[1.5px] mx-auto z-40 border-[0.5px] border-violet-300/50">
          <Button
            variant={!stdio ? "default" : "secondary"}
            size="xs"
            onClick={() => {
              setStdio(false);
              document
                .getElementById("getting-started")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
              // preserve current query string, only change the hash
              const url = new URL(window.location.href);
              url.hash = "#getting-started";
              window.history.pushState(
                window.history.state,
                "",
                url.toString(),
              );
            }}
            className={`${!stdio && "shadow-sm"} rounded-full !pr-3 !pl-2`}
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
              // preserve current query string, only change the hash
              const url = new URL(window.location.href);
              url.hash = "#getting-started";
              window.history.pushState(
                window.history.state,
                "",
                url.toString(),
              );
            }}
            className={`${stdio && "shadow-sm"} rounded-full !pr-3 !pl-2`}
          >
            <Cable className="size-4" />
            Stdio
          </Button>
        </div>
      </div>

      <div className="lg:border-r border-dashed border-white/10 p-4 sm:p-12 max-lg:border-b">
        <div className="flex items-start">
          <h2 className="flex-1 text-3xl font-bold mb-4">Getting Started</h2>
        </div>

        <Prose className="mb-6">
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
        </Prose>
      </div>
      <div className="bg-dots bg-fixed p-4 sm:p-12 flex items-start justify-center max-lg:container">
        {!stdio ? <RemoteSetupTabs /> : <StdioSetupTabs />}
      </div>
    </section>
  );
}
