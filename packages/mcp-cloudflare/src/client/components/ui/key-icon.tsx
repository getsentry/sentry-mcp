export function KeyIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="size-8 [box-shadow:0_4px_0_0_#695f89] duration-300 hover:translate-y-1 hover:[box-shadow:0_0px_0_0_#695f89] inline-grid place-items-center rounded-lg border border-white/10 bg-background-3">
      {children}
    </div>
  );
}
