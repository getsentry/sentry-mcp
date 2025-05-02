import { cn } from "@/client/lib/utils";

export function Prose({
  children,
  className,
  ...props
}: { children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("prose prose-invert max-w-none", className)} {...props}>
      {children}
    </div>
  );
}
