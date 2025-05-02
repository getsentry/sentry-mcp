import { cn } from "@/client/lib/utils";

export function Prose({
  children,
  className,
  ...props
}: { children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "prose prose-invert max-w-none prose-a:text-violet-300",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
