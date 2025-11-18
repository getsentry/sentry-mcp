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

type ActivationSource = "marker" | "manual";

const steps: Step[] = [
  {
    label: "Copypaste Sentry Issue URL",
    description: "Copy the Sentry issue url directly from your browser",
    startTime: 31.6,
    startSpeed: 5,
    autoContinueMs: 2500,
    autoPlay: false,
    lines: 7,
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
    startSpeed: 3,
    autoContinueMs: 2000,
    autoPlay: false,
    lines: 9,
  },
  {
    type: "[LLM]",
    label: "Finding solution",
    description: "LLM analyzes the context and comes up with a solution",
    startTime: 48.5,
    startSpeed: 48,
    autoContinueMs: 50,
    autoPlay: false,
    lines: 8,
  },
  {
    type: "[LLM]",
    label: "Applying Edits",
    description: "LLM adds the suggested solution to the codebase",
    startTime: 146,
    startSpeed: 24,
    autoContinueMs: 50,
    autoPlay: false,
    lines: 8,
  },
  {
    label: "Validation",
    description: "Automatically running tests to verify the solution works",
    startTime: 242,
    startSpeed: 3,
    autoContinueMs: 50,
    autoPlay: false,
    lines: 7,
  },
];

export default function TerminalAnimation() {
  const playerRef = useRef<any>(null);
  const cliDemoRef = useRef<HTMLDivElement | null>(null);

  const autoContinueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const currentStepRef = useRef<number>(-1);

  const [speed] = useState<number>(3.0);
  const EPS = 0.01;

  const didInitRef = useRef(false);
  const isMobileRef = useRef(false);

  const isManualSeekRef = useRef(false);

  const clearAllTimers = useCallback(() => {
    if (autoContinueTimerRef.current) {
      clearTimeout(autoContinueTimerRef.current);
      autoContinueTimerRef.current = null;
    }
  }, []);

  const hardDispose = useCallback(() => {
    clearAllTimers();
    try {
      const p = playerRef.current;
      p?.pause?.();
      p?.dispose?.();
    } catch {}
    playerRef.current = null;
    try {
      cliDemoRef.current?.replaceChildren();
    } catch {}
  }, [clearAllTimers]);

  const handleMarkerReached = useCallback(
    (markerIndex: number) => {
      const step = steps[markerIndex];
      if (!step) return;

      currentStepRef.current = markerIndex;
      setCurrentIndex(markerIndex);

      const p = playerRef.current;
      if (!p) return;

      const mobile = isMobileRef.current;
      const MOBILE_PAUSE_MS = 1000;

      // Determine if we should pause at this marker
      const shouldPause = mobile
        ? !!(step.autoContinueMs || !step.autoPlay)
        : !step.autoPlay;

      const continueDelay = shouldPause
        ? mobile
          ? MOBILE_PAUSE_MS
          : (step.autoContinueMs ?? 0)
        : 0;

      // Update player speed for this step
      try {
        if (step.startSpeed !== speed) {
          p.setSpeed?.(step.startSpeed);
        }
      } catch {}

      if (shouldPause) {
        try {
          p.pause?.();
        } catch {}

        if (continueDelay > 0) {
          clearAllTimers();
          autoContinueTimerRef.current = setTimeout(() => {
            try {
              p.play?.();
            } catch {}
          }, continueDelay);
        }
      } else {
        try {
          p.play?.();
        } catch {}
      }
    },
    [speed, clearAllTimers],
  );

  const mountOnce = useCallback(async () => {
    if (playerRef.current) return;

    try {
      isMobileRef.current =
        (typeof window !== "undefined" &&
          window.matchMedia?.("(hover: none)")?.matches) ||
        (typeof window !== "undefined" && window.innerWidth < 768);
    } catch {
      isMobileRef.current = false;
    }

    const AsciinemaPlayerLibrary = await import("asciinema-player" as any);
    if (!cliDemoRef.current) return;

    // Convert steps to markers format: [time, label]
    const markers = steps.map((step) => [step.startTime, step.label]);

    const player = AsciinemaPlayerLibrary.create(
      "demo.cast",
      cliDemoRef.current,
      {
        // NOTE: defaults to 80cols x 24rows until .cast loads, pulls size of terminal recondinf from .cast on load, unless below specified
        rows: Math.max(
          1,
          Math.floor(
            ((cliDemoRef.current?.getBoundingClientRect().height ?? 0) - 18) /
              16.82, // line-height
          ),
        ), // -18 for 9px border on <pre> for terminal output
        // NOTE: fits cols to container width (which is extended to 200% on mobile for optimal font-size result), or rows (specified above) to container height by decreasing the font size (note below)
        fit: "width",
        // NOTE: only works when fit: false
        // terimnalFontSize: 14,
        // NOTE: customized above in dracula.css
        theme: "dracula",
        controls: false,
        autoPlay: false,
        loop: false,
        idleTimeLimit: 0.1,
        speed,
        startAt: steps[0].startTime,
        preload: true,
        pauseOnMarkers: false,
        markers: markers,
      },
    );

    playerRef.current = player;

    // Listen to marker events from the player
    player.addEventListener("marker", (event: any) => {
      const { index } = event;
      if (!isManualSeekRef.current) {
        handleMarkerReached(index);
      }
    });

    // Listen for playback end to mark last step as complete
    player.addEventListener("ended", () => {
      // Mark the last step as completed by moving index beyond it
      currentStepRef.current = steps.length;
      setCurrentIndex(steps.length);
    });
  }, [speed, handleMarkerReached]);

  const gotoStep = useCallback(
    (idx: number) => {
      const p = playerRef.current;
      if (!p) return;

      const step = steps[idx];
      if (!step) return;

      clearAllTimers();
      isManualSeekRef.current = true;

      try {
        p.pause?.();
        p.seek?.(step.startTime + EPS);
        // Reset speed to step's speed
        if (step.startSpeed !== speed) {
          p.setSpeed?.(step.startSpeed);
        }
      } catch {}

      currentStepRef.current = idx;
      setCurrentIndex(idx);

      // Resume manual seek flag after a brief delay
      setTimeout(() => {
        isManualSeekRef.current = false;
      }, 100);

      const mobile = isMobileRef.current;
      if (!mobile && step.autoContinueMs) {
        autoContinueTimerRef.current = setTimeout(() => {
          try {
            p.play?.();
          } catch {}
        }, step.autoContinueMs);
      }
    },
    [speed, clearAllTimers],
  );

  const activateStep = useCallback(
    (stepIndex: number) => {
      gotoStep(stepIndex);
    },
    [gotoStep],
  );

  const restart = useCallback(() => {
    clearAllTimers();
    const p = playerRef.current;
    if (!p) return;

    currentStepRef.current = -1;
    setCurrentIndex(-1);

    try {
      p.pause?.();
      p.seek?.(steps[0].startTime + EPS);
      // Reset to initial speed
      p.setSpeed?.(speed);
    } catch {}

    // Start from the first marker
    setTimeout(() => {
      try {
        p.play?.();
      } catch {}
    }, 100);
  }, [clearAllTimers, speed]);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    (async () => {
      await mountOnce();
      // Start playing from the first marker
      setTimeout(() => {
        const p = playerRef.current;
        try {
          p?.play?.();
        } catch {}
      }, 100);
    })();

    return () => {
      clearAllTimers();
      hardDispose();
    };
  }, [mountOnce, clearAllTimers, hardDispose]);

  return (
    <>
      <div
        className={`${
          currentIndex === 1
            ? "xl:border-orange-400/50"
            : currentIndex === 2
              ? "xl:border-pink-400/50"
              : currentIndex === 4
                ? "xl:border-lime-200/50"
                : "border-white/10"
        } relative w-full flex flex-col justify-between col-span-2 gap-8 max-xl:row-span-6 border bg-background/50 rounded-3xl overflow-hidden`}
      >
        <div className="w-full relative overflow-hidden min-h-56 h-full [mask-image:radial-gradient(circle_at_top_right,transparent_10%,red_20%)]">
          <div
            className="absolute bottom-0 right-0 left-1 flex justify-start h-full w-[60rem] overflow-hidden rounded-3xl [mask-image:linear-gradient(to_bottom,transparent,red_0.5rem,red_calc(100%-0.5rem),transparent)] [&>.ap-wrapper>.ap-player]:w-full [&>.ap-wrapper]:w-full [&>.ap-wrapper]:flex [&>.ap-wrapper]:!justify-start [&>.ap-wrapper>.ap-player>.ap-terminal]:absolute [&>.ap-wrapper>.ap-player>.ap-terminal]:bottom-0"
            ref={cliDemoRef}
          />
        </div>

        <SpeedDisplay
          speed={
            currentIndex >= 0
              ? (steps[currentIndex]?.startSpeed ?? speed)
              : speed
          }
        />
        <KeysPaste step={currentIndex} />

        <div className="relative bottom-0 inset-x-0">
          <StepsList
            onSelectAction={(i) => (i === 0 ? restart() : activateStep(i))}
            globalIndex={Math.max(currentIndex, 0)}
            className=""
            restart={restart}
            steps={steps}
          />
        </div>
      </div>

      <div
        className={`${
          currentIndex > 4 ? "opacity-0 scale-y-50" : "opacity-100 scale-y-100"
        } duration-300 max-xl:hidden absolute h-full inset-y-0 left-1/2 -translate-x-1/2 w-8 py-12 flex justify-around flex-col`}
      >
        {Array.from({ length: 24 }).map((_, i) => (
          <DataWire
            // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
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
            delaySec={Math.random() * 0.3}
          />
        ))}
      </div>

      <div className="relative max-xl:row-span-0 hidden col-span-2 xl:flex flex-col w-full">
        <BrowserAnimation globalIndex={currentIndex} />
      </div>
    </>
  );
}
