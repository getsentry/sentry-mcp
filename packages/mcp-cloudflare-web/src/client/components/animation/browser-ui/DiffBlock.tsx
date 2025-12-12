export default function DiffBlock({
  diff,
  step,
  delay,
}: {
  diff: string[];
  step: number;
  delay: number;
}) {
  return (
    <pre
      className={`${
        step === 4
          ? "opacity-100 duration-300 pointer-events-auto"
          : "opacity-0 pointer-events-none"
      } absolute inset-0 top-10 z-50 h-full bg-background ![color:unset] text-sm`}
      style={{
        transitionDelay: step === 4 ? `${delay}s` : "0s",
      }}
    >
      {Array.isArray(diff) &&
        diff.map((line, idx) => (
          <div
            className={`text-nowrap ${
              step === 4
                ? "translate-x-0 opacity-100 duration-300"
                : "motion-safe:-translate-x-8 opacity-0"
            } ease-[cubic-bezier(0.64,0.57,0.67,1.53) ${
              line.includes("+")
                ? "bg-lime-300/30 text-lime-400"
                : line.includes("-")
                  ? "bg-red-300/30 text-red-400"
                  : "text-white/70"
            }}`}
            key={line}
            style={{
              transitionDelay: step === 4 ? `${delay + 0.025 * idx}s` : "0s",
            }}
          >
            {line}
          </div>
        ))}
    </pre>
  );
}
