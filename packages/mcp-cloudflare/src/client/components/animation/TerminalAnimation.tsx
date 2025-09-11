"use client";

import "asciinema-player/dist/bundle/asciinema-player.css";
import "./dracula.css";
import { useCallback, useEffect, useRef, useState } from "react";
import BrowserAnimation from "./BrowserAnimation";
import Paste from "./terminal-ui/Paste";
import SpeedDisplay from "./terminal-ui/SpeedDisplay";
import StepsList from "./terminal-ui/StepsList";
import CodeSnippet from "../ui/code-snippet";
import { ChevronRight, Sparkles } from "lucide-react";

export type Step = {
  type: string;
  time: number;
  label: string;
  description: string;
  autoContinueMs: number | null;
  restartSpeed: number;
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

  const currentStepRef = useRef<number>(-1);
  const [speed, setSpeed] = useState<number>(0.5);
  const [activeStep, setActiveStep] = useState<Step | null>(null);

  const steps: Step[] = [
    {
      type: "copy url",
      time: 31.75,
      label: "You Copy the Issue URL",
      description: "Copy the Sentry issue url directly from your browser",
      autoContinueMs: 1950,
      restartSpeed: 3,
      autoPlay: false,
    },
    {
      type: "toolcall",
      time: 40,
      label: "get_issue_details()",
      description: "MCP performs a toolcall to fetch issue details",
      autoContinueMs: 1000,
      restartSpeed: 3,
      autoPlay: false,
    },
    {
      type: "toolcall",
      time: 46,
      label: "analyze_issue_with_seer()",
      description:
        "A toolcall to Seer to analyze the stack trace and pinpoint the root cause",
      autoContinueMs: 3000,
      restartSpeed: 1.5,
      autoPlay: false,
    },
    {
      type: "LLM",
      time: 48.5,
      label: "Finding solution",
      description: "LLM analyzes the context and comes up with a solution",
      autoContinueMs: 1500,
      restartSpeed: 24,
      autoPlay: false,
    },
    {
      type: "LLM",
      time: 146,
      label: "Applying Edits",
      description: "LLM adds the suggested solution to the codebase",
      autoContinueMs: 1500,
      restartSpeed: 24,
      autoPlay: false,
    },
    {
      type: "test",
      time: 242,
      label: "Validation",
      description: "Automaticall running tests to verify the solution works",
      autoContinueMs: 100,
      restartSpeed: 25,
      autoPlay: false,
    },
  ];

  // factor your create logic so we can recreate on speed changes
  const mountPlayer = useCallback(
    async (resumeAtSec: number | null = null, newSpeed = speed) => {
      const AsciinemaPlayerLibrary = await import("asciinema-player" as any);
      if (!cliDemoRef.current) return;

      // dispose previous instance (if any)
      try {
        playerRef.current?.dispose?.();
      } catch {}

      const instance = AsciinemaPlayerLibrary.create(
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
          controls: false,
          autoPlay: true,
          loop: false,
          speed: newSpeed,
          idleTimeLimit: 0.1,
          markers: steps
            .filter((_, i) => i > currentStepRef.current) // strictly future steps
            .map((s) => [s.time, s.label] as const),
          pauseOnMarkers: true,
          ...(resumeAtSec != null ? { startAt: resumeAtSec } : { startAt: 31 }),
        },
      );

      instance.addEventListener(
        "marker",
        (ev: { index: number; time: number; label: string }) =>
          activateStep(currentStepRef.current + 1 + ev.index),
      );
      playerRef.current = instance;
    },
    [speed],
  );

  async function activateStep(stepIndex: number) {
    if (autoContinueTimerRef.current) {
      clearTimeout(autoContinueTimerRef.current);
      autoContinueTimerRef.current = null;
    }
    const globalIndex = stepIndex;
    // console.log(globalIndex);
    const step = steps[globalIndex];
    if (!step) return;

    setActiveStep(step);
    currentStepRef.current = globalIndex;

    playerRef.current?.pause?.();
    if (
      step.autoContinueMs != null &&
      step.autoContinueMs > 0 &&
      speed !== step.restartSpeed
    ) {
      // autoContinueTimerRef.current =
      setTimeout(async () => {
        playerRef.current?.dispose?.(); // dispose of the current instance
        setSpeed(step.restartSpeed);
        await mountPlayer(step.time + 1, step.restartSpeed); // recreate at current time with new speed
        // if (!step.autoPlay) playerRef.current?.pause?.();
        autoContinueTimerRef.current = null; // finished
      }, step.autoContinueMs);
    } else if (
      // reset if new speed
      speed !== step.restartSpeed
    ) {
      playerRef.current?.dispose?.(); // dispose of the current instance
      setSpeed(step.restartSpeed);
      await mountPlayer(step.time, step.restartSpeed);
      if (!step.autoPlay) playerRef.current?.pause?.();
    } else {
      // simply seek if old speed
      playerRef.current?.seek(step.time);
      playerRef.current?.play?.();
    }
  }

  useEffect(() => {
    mountPlayer(31, 0.5, true);
    return () => {
      try {
        playerRef.current?.dispose?.();
      } catch {}
    };
  }, [mountPlayer]);

  const onChangeSpeed = async (s: number) => {
    const p = playerRef.current;
    const at = p?.getCurrentTime?.() ?? 0;
    setSpeed(s);
    await mountPlayer(at, s); // recreate at current time with new speed
    // auto-continue playback
    playerRef.current?.play?.();
  };

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
        <div className="absolute bottom-0 left-0 right-0 p-4 lg:p-12 text-shadow-md bg-neutral-950 h-full flex flex-col justify-end [mask-image:linear-gradient(190deg,transparent_50%,red_69%)]">
          {/* <div className="max-w-96">
            You could try to explain your issue to the LLM, copy paste context,
            and run tests yourself
          </div>
          <br /> or you can just use <b>Sentry MCP</b> and... <br />{" "} */}
          <h1 className="text-4xl font-bold font-serif my-5 flex items-center">
            <ChevronRight className="-ml-2 size-8" /> fix the url
            <span className="animate-cursor-blink">_</span>
          </h1>
          <span className="opacity-60 ml-0.5">
            That's all it should take to fix your bugs
          </span>
          <div className="mt-6 flex flex-wrap gap-4 w-full">
            <div className="hidden sm:block">
              <CodeSnippet noMargin snippet={endpoint} />
            </div>
            <div className="px-6 py-2 flex items-center bg-violet-600 hover:bg-violet-700 text-white transition rounded-2xl font-bold border-2 border-white/20">
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
        </div>
      </div>

      {/* Browser Window side */}
      <div className="relative max-md:row-span-0 hidden col-span-2 md:flex flex-col w-full">
        <BrowserAnimation
          activeStep={activeStep || null}
          globalIndex={currentStepRef.current}
        />
        <div className="md:bg-white/5 md:rounded-2xl md:p-4 md:mt-8 group/griditem overflow-clip">
          <StepsList
            activeStepLabel={activeStep?.label || null}
            onSelectAction={(i) => activateStep(i)}
            globalIndex={currentStepRef.current}
            steps={steps} // renamed prop
          />
        </div>
      </div>
    </>
  );
}
