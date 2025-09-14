"use client";

import "asciinema-player/dist/bundle/asciinema-player.css";
import "./dracula.css";
import { useCallback, useEffect, useRef, useState } from "react";
import BrowserAnimation from "./BrowserAnimation";
import Paste from "./terminal-ui/Paste";
import SpeedDisplay from "./terminal-ui/SpeedDisplay";
import StepsList from "./terminal-ui/StepsList";

export type Step = {
  type?: string;
  label: string;
  description: string;
  startTime: number;
  startSpeed: number;
  autoContinueMs: number | null;
  autoPlay: boolean;
};

export default function TerminalAnimation({
  onChatClick,
}: {
  onChatClick: () => void;
}) {
  const playerRef = useRef<any>(null);
  const cliDemoRef = useRef<HTMLDivElement | null>(null);
  const autoContinueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const postSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const currentStepRef = useRef<number>(-1);
  const [speed, setSpeed] = useState<number>(0.5);
  const EPS = 0.01;

  const steps: Step[] = [
    {
      label: "You Copy Paste the Issue URL",
      description: "Copy the Sentry issue url directly from your browser",
      startTime: 31.6,
      startSpeed: 2,
      autoContinueMs: 1950,
      autoPlay: false,
    },
    {
      // type: "toolcall",
      label: "get_issue_details()",
      description: "MCP performs a toolcall to fetch issue details",
      startTime: 40,
      startSpeed: 3,
      autoContinueMs: 1000,
      autoPlay: false,
    },
    {
      // type: "toolcall",
      label: "analyze_issue_with_seer()",
      description:
        "A toolcall to Seer to analyze the stack trace and pinpoint the root cause",
      startTime: 46,
      startSpeed: 5,
      autoContinueMs: 2000,
      autoPlay: false,
    },
    {
      // type: "LLM",
      label: "Finding solution",
      description: "LLM analyzes the context and comes up with a solution",
      startTime: 48.5,
      startSpeed: 24,
      autoContinueMs: 1000,
      autoPlay: false,
    },
    {
      // type: "LLM",
      label: "Applying Edits",
      description: "LLM adds the suggested solution to the codebase",
      startTime: 146,
      startSpeed: 20,
      autoContinueMs: 1000,
      autoPlay: false,
    },
    {
      label: "Validation",
      description: "Automaticall running tests to verify the solution works",
      startTime: 242,
      startSpeed: 5,
      autoContinueMs: 1000,
      autoPlay: false,
    },
  ];

  const mountPlayer = useCallback(
    async (resumeAtSec: number, newSpeed: number, marker?: number) => {
      const AsciinemaPlayerLibrary = await import("asciinema-player" as any);
      if (!cliDemoRef.current) return;

      const target = resumeAtSec;

      const player = AsciinemaPlayerLibrary.create(
        "demo.cast",
        cliDemoRef.current,
        {
          rows:
            window.innerWidth > 1024
              ? window.innerWidth > 1234
                ? 24
                : 32
              : undefined,
          fit: window.innerWidth > 1024 ? "none" : "none",
          theme: "dracula",
          controls: true,
          autoPlay: true,
          loop: false,
          idleTimeLimit: 0.1,
          speed: newSpeed,
          // fixes first step
          startAt: Math.max(target - EPS, 0),
          ...(marker
            ? { pauseOnMarkers: true, markers: [marker] }
            : { pauseOnMarkers: false }),
        },
      );
      playerRef.current = player;

      if (postSeekTimerRef.current) {
        clearTimeout(postSeekTimerRef.current);
        postSeekTimerRef.current = null;
      }

      // setTimeout 0 microtask and seek fixes last step, pause is for every step
      postSeekTimerRef.current = setTimeout(() => {
        // eliminates race condition that happpens before 1st step (steps 0 and 1 firing at the same time with idelTimeLimit timeline adjustments)
        if (player !== playerRef.current) return;
        try {
          player.seek?.(target + EPS);
          if (
            !(
              currentStepRef.current === -1 ||
              steps[currentStepRef.current].autoPlay
            )
          ) {
            player.pause?.();
          }
        } catch {}
      }, 0);

      const onMarker = () => {
        // eliminates race condition that happpens before 1st step (steps 0 and 1 firing at the same time with idelTimeLimit timeline adjustments)
        if (player !== playerRef.current) return; // ignore stale instance
        activateStep(currentStepRef.current + 1);
      };
      player.addEventListener("marker", onMarker);
      (player as any).__onMarker = onMarker;
    },
    [],
  );

  function activateStep(stepIndex: number) {
    currentStepRef.current = stepIndex;
    setCurrentIndex(stepIndex);
    const step = steps[currentStepRef.current];
    if (!step) return;
    playerRef.current.pause?.();
    // remove previous marker listener if present
    if (playerRef.current.__onMarker) {
      try {
        playerRef.current.removeEventListener?.(
          "marker",
          playerRef.current.__onMarker,
        );
      } catch {}
    }
    playerRef.current.dispose?.();

    if (autoContinueTimerRef.current) {
      clearTimeout(autoContinueTimerRef.current);
      autoContinueTimerRef.current = null;
    }

    setSpeed(step.startSpeed);
    mountPlayer(
      step.startTime,
      step.startSpeed,
      steps[stepIndex + 1]?.startTime,
    );
    if (!step.autoPlay) playerRef.current.pause();
    if (step.autoContinueMs) {
      autoContinueTimerRef.current = setTimeout(async () => {
        playerRef.current?.play?.();
        autoContinueTimerRef.current = null; // finished
      }, step.autoContinueMs);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    // initial
    mountPlayer(31, 0.5, steps[0].startTime);
    return () => {
      try {
        playerRef.current?.dispose?.();
      } catch {}
    };
  }, []);

  const endpoint = new URL("/mcp", window.location.href).href;

  return (
    <>
      {/* Terminal Side */}
      <div className="relative w-full col-span-2 max-md:row-span-6 border border-white/10 bg-white/5 backdrop-blur-3xl rounded-2xl overflow-hidden">
        <div
          className="relative flex h-full w-full overflow-hidden rounded-2xl [&>.ap-wrapper>.ap-player]:w-full [&>.ap-wrapper]:w-full [mask-image:radial-gradient(circle_at_top_right,transparent_10%,red_20%)]"
          ref={cliDemoRef}
        />
        {/* <CustomControls
          onChangeSpeedAction={(i) => onChangeSpeed(i)}
          speed={speed}
        /> */}
        <SpeedDisplay speed={speed} />
        <Paste />
        {/* <div className="absolute bottom-0 left-0 right-0 p-4 lg:p-12 text-shadow-md bg-neutral-950 h-full flex flex-col justify-end [mask-image:linear-gradient(190deg,transparent_50%,red_69%)] pointer-events-none">
          <h1 className="text-4xl font-bold font-serif my-5 flex items-center pointer-events-auto">
            <ChevronRight className="-ml-2 size-8" /> fix the url
            <span className="animate-cursor-blink">_</span>
          </h1>
          <span className="opacity-60 ml-0.5 pointer-events-auto">
            That's all it could take to fix your bugs
          </span>
          <div className="mt-6 flex flex-wrap gap-4 w-full pointer-events-auto">
            <div className="hidden sm:block">
              <CodeSnippet noMargin snippet={endpoint} />
            </div>
            <div className="px-6 py-2 flex items-center bg-gradient-to-br from-violet-300 via-violet-600 to-violet-700 hover:bg-violet-700 text-white transition rounded-2xl font-bold border-2 border-white/20">
              Docs
            </div>
            <button
              type="button"
              onClick={() => onChatClick()}
              className="cursor-pointer px-5 py-2 flex items-center bg-neutral-700 hover:bg-neutral-600 transition rounded-2xl font-bold border-2 border-white/10"
            >
              <Sparkles className="size-5 mr-2" />
              Live Demo
            </button>
          </div>
        </div> */}
      </div>

      {/* Browser Window side */}
      <div className="relative max-md:row-span-0 hidden col-span-2 md:flex flex-col w-full">
        <BrowserAnimation globalIndex={currentIndex} />
        <div className="md:mt-8 group/griditem overflow-clip">
          <StepsList
            onSelectAction={(i) =>
              i === 0
                ? (() => {
                    currentStepRef.current = -1;
                    setCurrentIndex(-1);
                    autoContinueTimerRef.current = null;
                    playerRef.current.pause?.();
                    // remove previous marker listener if present
                    if (playerRef.current.__onMarker) {
                      try {
                        playerRef.current.removeEventListener?.(
                          "marker",
                          playerRef.current.__onMarker,
                        );
                      } catch {}
                    }
                    playerRef.current.dispose?.();
                    mountPlayer(31, 0.5, steps[0].startTime);
                  })()
                : activateStep(i)
            }
            globalIndex={Math.max(currentIndex, 0)}
            steps={steps}
          />
        </div>
      </div>
    </>
  );
}
