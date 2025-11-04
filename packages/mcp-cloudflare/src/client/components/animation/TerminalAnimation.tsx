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
  startTime: number; // seconds within the cast
  startSpeed: number; // used to detect "fast" steps (26 or 50)
  autoContinueMs: number | null;
  autoPlay: boolean;
};

type ActivationSource = "marker" | "manual";

/* --------------------------- steps (no `lines`) --------------------------- */
const steps: Step[] = [
  {
    label: "Copypaste Sentry Issue URL",
    description: "Copy the Sentry issue url directly from your browser",
    startTime: 31.6,
    startSpeed: 5,
    autoContinueMs: 2500,
    autoPlay: false,
  },
  {
    type: "[toolcall]",
    label: "get_issue_details()",
    description: "MCP performs a toolcall to fetch issue details",
    startTime: 40,
    startSpeed: 3,
    autoContinueMs: 1750,
    autoPlay: false,
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
  },
  {
    type: "[LLM]",
    label: "Finding solution",
    description: "LLM analyzes the context and comes up with a solution",
    startTime: 48.5,
    startSpeed: 50, // simulate via skip (effective 48x) when safe
    autoContinueMs: 50,
    autoPlay: false,
  },
  {
    type: "[LLM]",
    label: "Applying Edits",
    description: "LLM adds the suggested solution to the codebase",
    startTime: 146,
    startSpeed: 26, // simulate via skip (effective 24x) when safe
    autoContinueMs: 50,
    autoPlay: false,
  },
  {
    label: "Validation",
    description: "Automatically running tests to verify the solution works",
    startTime: 242,
    startSpeed: 26, // LAST STEP: play-through only (no seek) to avoid end reset
    autoContinueMs: 50,
    autoPlay: false,
  },
];

export default function TerminalAnimation() {
  const playerRef = useRef<any>(null);
  const cliDemoRef = useRef<HTMLDivElement | null>(null);

  // timers
  const boundaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoContinueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const microSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // UI state
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const currentStepRef = useRef<number>(-1);

  // fixed player config (no remounts)
  const [speed] = useState<number>(3.0); // fixed playback speed
  const fixedRows = 10; // default "lines" = 10
  const EPS = 0.01;

  // guards
  const didInitRef = useRef(false); // StrictMode guard
  const isMobileRef = useRef(false); // no pauses on mobile

  // generation token to invalidate old timers on rapid manual navigation
  const genRef = useRef(0);
  const bumpGen = useCallback(() => {
    genRef.current += 1;
    return genRef.current;
  }, []);

  const clearAllTimers = useCallback(() => {
    if (boundaryTimerRef.current) {
      clearTimeout(boundaryTimerRef.current);
      boundaryTimerRef.current = null;
    }
    if (autoContinueTimerRef.current) {
      clearTimeout(autoContinueTimerRef.current);
      autoContinueTimerRef.current = null;
    }
    if (microSeekTimerRef.current) {
      clearTimeout(microSeekTimerRef.current);
      microSeekTimerRef.current = null;
    }
    if (skipTimerRef.current) {
      clearTimeout(skipTimerRef.current);
      skipTimerRef.current = null;
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

    const player = AsciinemaPlayerLibrary.create(
      "demo.cast",
      cliDemoRef.current,
      {
        rows: fixedRows,
        fit: "none",
        theme: "dracula",
        controls: false,
        autoPlay: true,
        loop: false,
        idleTimeLimit: 0.1,
        speed: speed,
        startAt: 0,
        preload: true,
        pauseOnMarkers: false,
      },
    );

    playerRef.current = player;

    microSeekTimerRef.current = setTimeout(() => {
      try {
        player.seek?.(steps[0].startTime + EPS);
      } catch {}
    }, 0);
  }, [speed]);

  const realMsForCastSec = useCallback(
    (castSec: number) => (castSec / speed) * 1000,
    [speed],
  );

  const getDurationSec = () => {
    const p = playerRef.current;
    try {
      const d = p?.getDuration?.() ?? p?.duration ?? null;
      if (typeof d === "number" && Number.isFinite(d) && d > 0)
        return d as number;
    } catch {}
    // hard fallback if the API isn't available
    return (steps[steps.length - 1]?.startTime ?? 0) + 120;
  };

  // Fast-step plan: perceived multipliers 24 (for 26) and 48 (for 50)
  function planFastStepPlayback(segmentSec: number, startSpeed: number) {
    const eff = startSpeed === 50 ? 48 : 24;
    const neededCastToWatchSec = segmentSec * (speed / eff);
    const front = Math.min(segmentSec * 0.15, neededCastToWatchSec * 0.5);
    const watchedFront = Math.max(0, Math.min(front, neededCastToWatchSec));
    const watchedTail = Math.max(0, neededCastToWatchSec - watchedFront);
    const skipMiddle = Math.max(0, segmentSec - (watchedFront + watchedTail));
    return { watchedFront, watchedTail, skipMiddle }; // seconds of cast
  }

  // jump to a step (no remount), optionally pause on entry
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  const gotoStep = useCallback(
    (idx: number, opts?: { forcePause?: boolean }) => {
      const p = playerRef.current;
      if (!p) return;

      const step = steps[idx];
      if (!step) return;

      // bump generation to invalidate any previous timers
      const myGen = bumpGen();

      clearAllTimers();
      currentStepRef.current = idx;
      setCurrentIndex(idx);

      try {
        p.pause?.();
        p.seek?.(step.startTime + EPS);
      } catch {}

      const mobile = isMobileRef.current;
      const shouldPause = mobile ? false : (opts?.forcePause ?? !step.autoPlay);
      const entryDelay = mobile
        ? 0
        : step.autoContinueMs && shouldPause
          ? step.autoContinueMs
          : 0;

      if (shouldPause) {
        try {
          p.pause?.();
        } catch {}
      }

      const startPlayback = () => {
        // guard: if generation changed while waiting, abort
        if (genRef.current !== myGen) return;

        try {
          p.play?.();
        } catch {}

        const next = steps[idx + 1];
        const isLast = !next;

        const duration = getDurationSec();
        const endTime = isLast ? duration : next.startTime;
        const segmentSec = Math.max(0, endTime - step.startTime);

        // LAST STEP: **play-through only** (NO seeks) to guarantee no reset
        if (isLast) {
          // No boundary timers, no pauses — just let it run to the real end.
          return;
        }

        // Fast step with skip (26 or 50), for non-last steps only
        if (step.startSpeed === 26 || step.startSpeed === 50) {
          const { watchedFront, watchedTail, skipMiddle } =
            planFastStepPlayback(segmentSec, step.startSpeed);

          const frontMs = Math.max(
            34,
            Math.floor(realMsForCastSec(watchedFront)),
          );
          const tailMs = Math.max(
            34,
            Math.floor(realMsForCastSec(watchedTail)),
          );

          // After front chunk, seek to near the end of the segment (but not past)
          const doTail = () => {
            if (genRef.current !== myGen) return;

            try {
              const seekTo = Math.min(
                step.startTime + watchedFront + skipMiddle,
                endTime - 0.05, // never jump inside the next step
              );
              p.seek?.(seekTo);
              p.play?.();
            } catch {}

            boundaryTimerRef.current = setTimeout(() => {
              if (genRef.current !== myGen) return;
              if (!isMobileRef.current) {
                try {
                  p.pause?.();
                } catch {}
              }
              activateStep(idx + 1, "marker");
            }, tailMs);
          };

          skipTimerRef.current = setTimeout(doTail, frontMs);
          return;
        }

        // Normal step (no fast skip)
        let ms = Math.floor(realMsForCastSec(segmentSec));
        if (ms < 34) ms = 34;

        boundaryTimerRef.current = setTimeout(
          () => {
            if (genRef.current !== myGen) return;
            if (!isMobileRef.current) {
              try {
                p.pause?.();
              } catch {}
            }
            activateStep(idx + 1, "marker");
          },
          Math.max(0, ms),
        );
      };

      if (entryDelay > 0) {
        autoContinueTimerRef.current = setTimeout(() => {
          if (genRef.current !== myGen) return;
          startPlayback();
        }, entryDelay);
      } else {
        startPlayback();
      }
    },
    [realMsForCastSec],
  );

  const activateStep = useCallback(
    async (stepIndex: number, source: ActivationSource = "manual") => {
      // bump gen first so any in-flight timers from prior steps self-cancel
      bumpGen();
      clearAllTimers();

      if (source === "manual") {
        gotoStep(stepIndex, { forcePause: !isMobileRef.current });
        const step = steps[stepIndex];
        if (!isMobileRef.current && step?.autoContinueMs) {
          const myGen = genRef.current;
          autoContinueTimerRef.current = setTimeout(() => {
            if (genRef.current !== myGen) return;
            try {
              playerRef.current?.play?.();
            } catch {}
          }, step.autoContinueMs);
        }
        return;
      }

      // synthetic "marker" path
      gotoStep(stepIndex, { forcePause: !isMobileRef.current });
      const step = steps[stepIndex];
      if (!isMobileRef.current && step?.autoContinueMs) {
        const myGen = genRef.current;
        autoContinueTimerRef.current = setTimeout(() => {
          if (genRef.current !== myGen) return;
          try {
            playerRef.current?.play?.();
          } catch {}
        }, step.autoContinueMs);
      }
    },
    [bumpGen, clearAllTimers, gotoStep],
  );

  const restart = useCallback(() => {
    bumpGen();
    clearAllTimers();
    const p = playerRef.current;
    if (!p) return;

    try {
      p.pause?.();
      p.seek?.(steps[0].startTime + EPS);
    } catch {}

    currentStepRef.current = -1;
    setCurrentIndex(-1);

    activateStep(0, "marker");
  }, [activateStep, bumpGen, clearAllTimers]);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    (async () => {
      await mountOnce();
      setTimeout(() => activateStep(0, "marker"), 0);
    })();

    return () => {
      bumpGen();
      clearAllTimers();
      hardDispose();
    };
  }, [mountOnce, activateStep, bumpGen, clearAllTimers, hardDispose]);

  /* ===================== TEMPLATE (unchanged) ===================== */
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

      {/* Browser Window side */}
      <div className="relative max-xl:row-span-0 hidden col-span-2 xl:flex flex-col w-full">
        <BrowserAnimation globalIndex={currentIndex} />
      </div>
    </>
  );
}
