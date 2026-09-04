import { cn } from "@/client/lib/utils";

export function FxIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("fill-current size-4", className)}
      aria-hidden="true"
    >
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fontSize="14"
        fontFamily="monospace"
        fontWeight="bold"
      >
        fx
      </text>
    </svg>
  );
}
