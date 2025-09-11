export default function DiffBlock(diff: string[], step: number, delay: number) {
  return (
    <pre
      className={`${step === 4 ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"} absolute inset-0 top-10 z-50 h-full bg-500 text-sm duration-300`}
      style={{
        transitionDelay: step === 4 ? `${delay}s` : "0s",
      }}
    >
      {Array.isArray(diff) &&
        diff.map((line, idx) => (
          <div
            className={`${step === 4 ? "translate-x-0 opacity-100 blur-none duration-300" : "-translate-x-8 opacity-0 blur-xl"} ease-[cubic-bezier(0.64,0.57,0.67,1.53) ${line.includes("+") ? "!text-lime-800 !bg-lime-400" : line.includes("-") ? "!text-red-800 !bg-red-400" : "text-white/70"}}`}
            key={line}
            style={{
              transitionDelay: step === 4 ? `${delay + 0.05 * idx}s` : "0s",
            }}
          >
            {line}
          </div>
        ))}
    </pre>
  );
}
