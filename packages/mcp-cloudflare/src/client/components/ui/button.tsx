import type * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-violet-300 text-black shadow-xs hover:bg-violet-300/90",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20",
        outline:
          "bg-slate-800/50 border border-slate-600/50 shadow-xs hover:bg-slate-700/50 hover:text-white ",
        secondary:
          "bg-background shadow-xs hover:bg-violet-300 hover:text-black",
        ghost: "hover:text-white hover:bg-slate-700/50 ",
        link: "text-primary hover:underline hover:text-violet-300 cursor-pointer",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        xs: "h-7 gap-1.5 px-2 has-[>svg]:px-1.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
      active: {
        true: "text-violet-300 underline",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  active = false,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    active?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className, active }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
