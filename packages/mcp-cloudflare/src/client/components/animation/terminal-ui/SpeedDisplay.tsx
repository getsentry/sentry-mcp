"use client";

import { ChevronsRight } from "lucide-react";
import { useEffect, useState } from "react";

type SpeedDisplayProps = {
  speed: number | string;
  /** total animation time; keep in sync with CSS via a CSS var */
  durationMs?: number;
  className?: string;
};

export default function SpeedDisplay({
  speed,
  durationMs = 500,
  className = "",
}: SpeedDisplayProps) {
  const [animate, setAnimate] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: change in speed triggers the animation
  useEffect(() => {
    setAnimate(true);
    const t = setTimeout(() => setAnimate(false), durationMs);
    return () => clearTimeout(t);
  }, [speed, durationMs]);

  return (
    <div
      aria-live="polite"
      className={`absolute top-8 right-10 z-40 flex items-center font-bold text-4xl opacity-50 ${
        animate ? "speed-animate" : ""
      } ${className}`}
      style={{ ["--speed-pop-dur" as any]: `${durationMs}ms` }}
    >
      <ChevronsRight className="size-12" />
      {speed}x
    </div>
  );
}
