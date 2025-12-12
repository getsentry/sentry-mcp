import { cn } from "../../lib/utils";

export function Heading({
  children,
  as,
  className,
  ...props
}: {
  children: React.ReactNode;
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
} & React.HTMLAttributes<HTMLHeadingElement>) {
  const Tag = as || "h2";
  return (
    <Tag
      className={cn("text-2xl font-bold mb-6 text-white", className)}
      {...props}
    >
      <div className="flex flex-row gap-2">{children}</div>
      <div className="h-[2px] mt-1 bg-violet-300 w-full" />
    </Tag>
  );
}

export function Link({
  children,
  className,
  href,
  ...props
}: {
  children: React.ReactNode;
  href: string;
} & React.HTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={href}
      className={cn("text-violet-300 font-semibold underline", className)}
      {...props}
    >
      {children}
    </a>
  );
}
