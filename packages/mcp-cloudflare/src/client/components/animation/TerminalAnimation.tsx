"use client";

import "asciinema-player/dist/bundle/asciinema-player.css";
import "./dracula.css";
import { useCallback, useEffect, useRef, useState } from "react";
import BrowserAnimation from "./BrowserAnimation";
import KeysPaste from "./terminal-ui/keys-paste";
import SpeedDisplay from "./terminal-ui/SpeedDisplay";
import StepsList from "./terminal-ui/StepsList";
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

type ActivationSource = "marker" | "manual";

let __cachedCastData: any[] | null = null;

async function loadCastOnce(url: string): Promise<any[]> {
  if (__cachedCastData) return __cachedCastData;

  const res = await fetch(url);
  const text = await res.text(); // asciicast v2 is ndjson
  const lines = text.split(/\r?\n/).filter(Boolean);
  const parsed = lines.map((ln, i) =>
    i === 0 ? JSON.parse(ln) : JSON.parse(ln),
  );
  __cachedCastData = parsed; // cache in module scope
  return parsed;
}

export default function TerminalAnimation() {
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

      const castData = await loadCastOnce("demo.cast"); // fetch+parse only once

      // Clean up any stale player listener before creating a new one
      try {
        if (playerRef.current?.__onMarker) {
          playerRef.current.removeEventListener?.(
            "marker",
            playerRef.current.__onMarker,
          );
        }
        playerRef.current?.dispose?.();
      } catch {}

      const target = resumeAtSec;

      const player = AsciinemaPlayerLibrary.create(
        { data: castData },
        cliDemoRef.current,
        {
          rows: lines || 10,
          fit: "none",
          theme: "dracula",
          controls: false,
          autoPlay: true,
          loop: false,
          idleTimeLimit: 0.1,
          speed: newSpeed,
          preload: true,
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
      // auto progression: delayed remount
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
    // init
    mountPlayer(31, 0.5, steps[0].lines, steps[0].startTime);
    return () => {
      try {
        if (playerRef.current?.__onMarker) {
          playerRef.current.removeEventListener?.(
            "marker",
            playerRef.current.__onMarker,
          );
        }
      } catch {}
      try {
        playerRef.current?.dispose?.();
      } catch {}
      if (autoContinueTimerRef.current)
        clearTimeout(autoContinueTimerRef.current);
      if (postSeekTimerRef.current) clearTimeout(postSeekTimerRef.current);
    };
  }, [mountPlayer]);

  return (
    <>
      {/* Terminal Side */}
      <div
        className={`${
          currentIndex === 1
            ? "xl:border-orange-400/50"
            : currentIndex === 2
              ? "xl:border-pink-400/50"
              : currentIndex === 4
                ? "xl:border-lime-200/50"
                : "border-white/10"
        } relative w-full col-span-2 max-xl:row-span-6 border bg-background/50 rounded-3xl overflow-hidden`}
      >
        <div className="w-full h-full [mask-image:linear-gradient(190deg,red_31%,transparent_50%)]">
          <div
            className="relative flex h-full w-full overflow-hidden rounded-3xl [&>.ap-wrapper>.ap-player]:w-full [&>.ap-wrapper]:w-full [mask-image:radial-gradient(circle_at_top_right,transparent_10%,red_20%)]"
            ref={cliDemoRef}
          />
        </div>

        <SpeedDisplay speed={speed} />
        <KeysPaste step={currentIndex} />

        <div className="absolute bottom-0 inset-x-0">
          <StepsList
            onSelectAction={(i) => (i === 0 ? restart() : activateStep(i))}
            globalIndex={Math.max(currentIndex, 0)}
            className=""
            restart={restart}
            steps={steps}
          />
        </div>
      </div>

      {/* Data wires */}
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
                ? "text-lime-200/50"
                : currentIndex === 2
                  ? "text-pink-400/50"
                  : "text-orange-400/50"
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
      </div>
    </>
  );
}
