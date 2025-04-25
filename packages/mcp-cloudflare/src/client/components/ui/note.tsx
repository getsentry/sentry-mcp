export default function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-4 bg-black/30 mb-6">
      <p className="text-gray-300 text-base">{children}</p>
    </div>
  );
}
