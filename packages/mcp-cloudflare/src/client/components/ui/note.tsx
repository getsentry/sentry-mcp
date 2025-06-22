export default function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="text-slate-300 text-base">{children}</p>
    </div>
  );
}
