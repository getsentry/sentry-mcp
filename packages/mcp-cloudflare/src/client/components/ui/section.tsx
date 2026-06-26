import type { ReactNode } from "react";
import { Heading } from "./base";
import { cn } from "@/client/lib/utils";

export default function Section({
  heading,
  children,
  className,
  ...props
}: {
  heading?: string | ReactNode;
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section className={cn("space-y-4 mb-10", className)} {...props}>
      {heading && <Heading>{heading}</Heading>}
      {children}
    </section>
  );
}
