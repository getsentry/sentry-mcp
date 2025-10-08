"use client";

import "asciinema-player/dist/bundle/asciinema-player.css";
import "./dracula.css";
import { useCallback, useEffect, useRef, useState } from "react";
import BrowserAnimation from "./BrowserAnimation";
import Paste from "./terminal-ui/Paste";
import SpeedDisplay from "./terminal-ui/SpeedDisplay";
import StepsList from "./terminal-ui/StepsList";
import { BookText, MessageSquareText, RotateCcw } from "lucide-react";
import CodeSnippet from "../ui/code-snippet";
import DataWire from "./DataWire";

export type Step = {
  type?: string;
  label: string;
  description: string;
  startTime: number;
  startSpeed: number;
  autoContinueMs: number | null;
  autoPlay: boolean;
  lines: number;
};

type ActivationSource = "marker" | "manual";

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
      label: "Copypaste Sentry Issue URL",
      description: "Copy the Sentry issue url directly from your browser",
      startTime: 31.6,
      startSpeed: 5,
      autoContinueMs: 2500,
      autoPlay: false,
      lines: 5,
    },
    {
      type: "[toolcall]",
      label: "get_issue_details()",
      description: "MCP performs a toolcall to fetch issue details",
      startTime: 40,
      startSpeed: 3,
      autoContinueMs: 1750,
      autoPlay: false,
      lines: 10,
    },
    {
      type: "[toolcall]",
      label: "analyze_issue_with_seer()",
      description:
        "A toolcall to Seer to analyze the stack trace and pinpoint the root cause",
      startTime: 46,
      startSpeed: 2,
      autoContinueMs: 2000,
      autoPlay: false,
      lines: 9,
    },
    {
      type: "[LLM]",
      label: "Finding solution",
      description: "LLM analyzes the context and comes up with a solution",
      startTime: 48.5,
      startSpeed: 50,
      autoContinueMs: 50,
      autoPlay: false,
      lines: 8,
    },
    {
      type: "[LLM]",
      label: "Applying Edits",
      description: "LLM adds the suggested solution to the codebase",
      startTime: 146,
      startSpeed: 26,
      autoContinueMs: 50,
      autoPlay: false,
      lines: 8,
    },
    {
      label: "Validation",
      description: "Automaticall running tests to verify the solution works",
      startTime: 242,
      startSpeed: 26,
      autoContinueMs: 50,
      autoPlay: false,
      // 32
      lines: 7,
    },
  ];

  const mountPlayer = useCallback(
    async (
      resumeAtSec: number,
      newSpeed: number,
      lines: number,
      marker?: number,
      manual?: boolean,
    ) => {
      const AsciinemaPlayerLibrary = await import("asciinema-player" as any);
      if (!cliDemoRef.current) return;

      const target = resumeAtSec;

      const player = AsciinemaPlayerLibrary.create(
        "demo.cast",
        cliDemoRef.current,
        {
          rows: lines || 10,
          fit: window.innerWidth > 1024 ? "none" : "none",
          theme: "dracula",
          controls: false,
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
            manual &&
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
        activateStep(currentStepRef.current + 1, "marker");
        // activateStep(currentStepRef.current + 1, manual ? "manual" : "marker");
      };
      player.addEventListener("marker", onMarker);
      (player as any).__onMarker = onMarker;
    },
    [],
  );

  async function activateStep(
    stepIndex: number,
    source: ActivationSource = "manual",
  ) {
    currentStepRef.current = stepIndex;
    setCurrentIndex(stepIndex);
    const step = steps[currentStepRef.current];
    if (!step) return;

    if (autoContinueTimerRef.current) {
      clearTimeout(autoContinueTimerRef.current);
      autoContinueTimerRef.current = null;
    }

    // if (!step.autoPlay) playerRef.current.pause?.();

    // Step 0 special-case: if auto-activated by marker, do NOT auto-continue.
    // const shouldAutoContinue = !(stepIndex === 0 && source === "marker");
    // if (step.autoContinueMs) {
    //   autoContinueTimerRef.current = setTimeout(async () => {
    //     playerRef.current.pause?.();
    //     // remove previous marker listener if present
    //     if (playerRef.current.__onMarker) {
    //       try {
    //         playerRef.current.removeEventListener?.(
    //           "marker",
    //           playerRef.current.__onMarker,
    //         );
    //       } catch {}
    //     }
    //     playerRef.current.dispose?.();
    //     setSpeed(step.startSpeed);
    //     mountPlayer(
    //       step.startTime,
    //       step.startSpeed,
    //       // last step 7
    //       steps[stepIndex + 1]?.lines || 7,
    //       steps[stepIndex + 1]?.startTime,
    //     );
    //     playerRef.current?.play?.();
    //     autoContinueTimerRef.current = null; // finished
    //   }, step.autoContinueMs);
    // }
    if (source === "manual") {
      // instant remount for manual selection, then pause; delay starts NOW
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
      setSpeed(step.startSpeed);
      await mountPlayer(
        step.startTime,
        step.startSpeed,
        // current step lines on manual step click
        step.lines,
        steps[stepIndex + 1]?.startTime,
        true,
      );
      playerRef.current.pause?.();
      if (step.autoContinueMs) {
        autoContinueTimerRef.current = setTimeout(() => {
          // simply play; marker listener will advance to next step
          playerRef.current?.play?.();
          autoContinueTimerRef.current = null;
        }, step.autoContinueMs);
      }
    } else if (step.autoContinueMs) {
      // auto progression: keep your delayed remount
      autoContinueTimerRef.current = setTimeout(() => {
        playerRef.current.pause?.();
        if (playerRef.current.__onMarker) {
          try {
            playerRef.current.removeEventListener?.(
              "marker",
              playerRef.current.__onMarker,
            );
          } catch {}
        }
        playerRef.current.dispose?.();
        setSpeed(step.startSpeed);
        mountPlayer(
          step.startTime,
          step.startSpeed,
          // next step lines because currentIndex starts at -1 so markers are 1 behind
          steps[stepIndex + 1]?.lines || 7,
          steps[stepIndex + 1]?.startTime,
        );
        playerRef.current?.play?.();
        autoContinueTimerRef.current = null;
      }, step.autoContinueMs);
    }
  }

  function restart() {
    currentStepRef.current = -1;
    setCurrentIndex(-1);
    setSpeed(0.5);
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
    mountPlayer(31, 0.5, steps[0].lines, steps[0].startTime);
  }

  useEffect(() => {
    // initial
    mountPlayer(31, 0.5, steps[0].lines, steps[0].startTime);
    return () => {
      try {
        playerRef.current?.dispose?.();
      } catch {}
    };
  }, [mountPlayer]);

  const endpoint = new URL("/mcp", window.location.href).href;

  return (
    <>
      {/* Terminal Side */}
      <div
        className={`${
          currentIndex === 1
            ? "xl:border-pink-400/50"
            : currentIndex === 2
              ? "xl:border-orange-400/50"
              : currentIndex === 4
                ? "xl:border-lime-400/50"
                : "border-white/10"
        } relative w-full col-span-2 max-xl:row-span-6 border bg-[#160f24]/50 backdrop-blur-3xl rounded-3xl overflow-hidden`}
      >
        <div className="w-full h-full [mask-image:linear-gradient(190deg,red_31%,transparent_50%)]">
          <div
            className="relative flex h-full w-full overflow-hidden rounded-3xl [&>.ap-wrapper>.ap-player]:w-full [&>.ap-wrapper]:w-full [mask-image:radial-gradient(circle_at_top_right,transparent_10%,red_20%)]"
            ref={cliDemoRef}
          />
        </div>
        {/* <CustomControls
          onChangeSpeedAction={(i) => onChangeSpeed(i)}
          speed={speed}
        /> */}
        <SpeedDisplay speed={speed} />
        <Paste step={currentIndex} />
        <div className="absolute bottom-0 left-0 right-0 p-4 text-shadow-md h-full flex flex-col justify-end">
          <div className="relative">
            <button
              type="button"
              className={`border group/replay border-white/20 bg-white/15 hover:bg-white/30 active:bg-white/50 active:duration-75 duration-300 absolute -top-14 rounded-full px-3 py-1 left-0 z-50 cursor-pointer hover:duration-300 hover:delay-0 text-nowrap ${
                currentIndex === 5
                  ? "opacity-100 translate-y-0 delay-3000 duration-500 blur-none pointer-events-auto"
                  : "opacity-0 translate-y-1/2 pointer-events-none blur-xl"
              }`}
              onClick={() => restart()}
            >
              Missed a step? Replay
              <RotateCcw className="inline-block size-4 ml-2 group-hover/replay:-rotate-360 group-hover/replay:ease-out group-hover/replay:duration-1000" />
            </button>
          </div>
          <div className="flex flex-col-reverse sm:flex-col gap-4">
            <div className="xl:mt-0 group/griditem overflow-clip">
              <StepsList
                onSelectAction={(i) => (i === 0 ? restart() : activateStep(i))}
                globalIndex={Math.max(currentIndex, 0)}
                steps={steps}
              />
            </div>
            {/* <h1 className="text-4xl font-bold font-sans my-5 flex items-center pointer-events-auto">
            <ChevronRight className="-ml-2 size-8" />
            fix the url
            <span className="animate-cursor-blink">_</span>
          </h1> */}
            {/* <span className="pointer-events-auto">
            That's all it could take to fix your bugs
          </span> */}
            <div className="flex flex-wrap gap-4 w-full pointer-events-auto">
              <div className="hidden sm:block">
                <CodeSnippet noMargin snippet={endpoint} />
              </div>
              <div className="pl-3 pr-3.5 py-2 rounded-xl flex items-center cursor-pointer bg-[#362e5a] hover:bg-[#665e8a] text-white transition font-bold font-sans border border-violet-300/25">
                <BookText className="size-5 mr-2" />
                Docs
              </div>
              <button
                type="button"
                onClick={() => onChatClick()}
                className="cursor-pointer pl-3 pr-3.5 py-2 rounded-xl flex items-center bg-white text-background hover:bg-violet-300 transition font-bold font-sans border border-background"
              >
                <MessageSquareText className="size-5 mr-2" />
                Live Demo
              </button>
            </div>
          </div>
        </div>
      </div>
      <div
        className={`${
          currentIndex > 4 ? "opacity-0 scale-y-50" : "opacity-100 scale-y-100"
        } duration-300 max-xl:hidden absolute h-full inset-y-0 left-1/2 -translate-x-1/2 w-8 py-12 flex justify-around flex-col`}
      >
        {Array.from({ length: 24 }).map((_, i) => (
          <DataWire
            // biome-ignore lint/suspicious/noArrayIndexKey: fake array in-place
            key={i}
            active={
              currentIndex === 1 || currentIndex === 2 || currentIndex === 4
            }
            direction={currentIndex === 4 ? "ltr" : "rtl"}
            pulseColorClass={
              currentIndex === 4
                ? "text-lime-400/50"
                : currentIndex === 2
                  ? "text-orange-400/50"
                  : "text-pink-400/50"
            }
            heightClass="h-0.5"
            periodSec={0.3}
            pulseWidthPct={200}
            delaySec={Math.random() * 0.3} // stagger: each later wire starts 0.05s later
          />
        ))}
      </div>

      {/* Browser Window side */}
      <div className="relative max-xl:row-span-0 hidden col-span-2 xl:flex flex-col w-full">
        <BrowserAnimation globalIndex={currentIndex} />
        {/* <div className="xl:mt-0 group/griditem overflow-clip">
          <StepsList
            onSelectAction={(i) => (i === 0 ? restart() : activateStep(i))}
            globalIndex={Math.max(currentIndex, 0)}
            steps={steps}
          />
        </div> */}
      </div>
    </>
  );
}
