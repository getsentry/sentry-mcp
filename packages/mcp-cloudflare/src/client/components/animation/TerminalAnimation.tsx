"use client";

import "asciinema-player/dist/bundle/asciinema-player.css";
import "./dracula.css";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
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

  const boundaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoContinueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const microSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const currentStepRef = useRef<number>(-1);

  const [speed] = useState<number>(3.0);
  const fixedRows = 10;
  const EPS = 0.01;

  const didInitRef = useRef(false);
  const isMobileRef = useRef(false);

  const genRef = useRef(0);
  const bumpGen = useCallback(() => ++genRef.current, []);

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
        speed,
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

  const getDurationSec = useCallback(() => {
    const p = playerRef.current;
    try {
      const d = p?.getDuration?.() ?? p?.duration ?? null;
      if (typeof d === "number" && Number.isFinite(d) && d > 0)
        return d as number;
    } catch {}
    return (steps[steps.length - 1]?.startTime ?? 0) + 120;
  }, []);

  const planFastStep = useCallback(
    (segmentSec: number, effectiveSpeed: number) => {
      const eff = Math.max(1, effectiveSpeed);
      const need = segmentSec * (speed / eff);
      const front = Math.min(segmentSec * 0.15, need * 0.5);
      const wf = Math.max(0, Math.min(front, need));
      const wt = Math.max(0, need - wf);
      const skip = Math.max(0, segmentSec - (wf + wt));
      return { wf, wt, skip };
    },
    [speed],
  );

  const gotoStep = useCallback(
    (idx: number, opts?: { forcePause?: boolean }) => {
      const p = playerRef.current;
      if (!p) return;

      const step = steps[idx];
      if (!step) return;

      const myGen = bumpGen();
      clearAllTimers();
      currentStepRef.current = idx;
      setCurrentIndex(idx);

      const next = steps[idx + 1];
      const isLast = !next;

      const duration = getDurationSec();
      const endTime = isLast ? duration : next.startTime;
      const segmentSec = Math.max(0, endTime - step.startTime);

      if (isLast) {
        try {
          p.pause?.();
          p.seek?.(step.startTime + EPS);
          p.play?.();
        } catch {}
        return;
      }

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
        if (genRef.current !== myGen) return;
        try {
          p.play?.();
        } catch {}

        if (step.startSpeed > speed) {
          const { wf, wt, skip } = planFastStep(segmentSec, step.startSpeed);
          const frontMs = Math.max(34, Math.floor(realMsForCastSec(wf)));
          const tailMs = Math.max(34, Math.floor(realMsForCastSec(wt)));

          const doTail = () => {
            if (genRef.current !== myGen) return;
            try {
              const seekTo = Math.min(
                step.startTime + wf + skip,
                endTime - 0.2,
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

        let ms = Math.floor(realMsForCastSec(segmentSec));
        if (ms < 34) ms = 34;

        boundaryTimerRef.current = setTimeout(() => {
          if (genRef.current !== myGen) return;
          if (!isMobileRef.current) {
            try {
              p.pause?.();
            } catch {}
          }
          activateStep(idx + 1, "marker");
        }, ms);
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
    [
      realMsForCastSec,
      bumpGen,
      clearAllTimers,
      getDurationSec,
      planFastStep,
      speed,
    ],
  );

  const activateStep = useCallback(
    async (stepIndex: number, source: ActivationSource = "manual") => {
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
    [gotoStep, clearAllTimers, bumpGen],
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

  const linesDiffRem = useMemo(() => {
    const lines =
      currentIndex >= 0 ? (steps[currentIndex]?.lines ?? fixedRows) : fixedRows;
    const diff = Math.max(0, fixedRows - lines);
    return `translateY(-${diff * 20}px)`;
  }, [currentIndex]);

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
        } relative w-full flex flex-col justify-between col-span-2 max-xl:row-span-6 border bg-background/50 rounded-3xl overflow-hidden`}
      >
        <div className="w-full [mask-image:linear-gradient(180deg,red_14rem,transparent_14rem)] max-h-56">
          <div
            className="relative flex h-full w-full overflow-hidden rounded-3xl [&>.ap-wrapper>.ap-player]:w-full [&>.ap-wrapper]:w-full [mask-image:radial-gradient(circle_at_top_right,transparent_10%,red_20%)] duration-300"
            ref={cliDemoRef}
            style={{ transform: linesDiffRem, willChange: "transform" }}
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
