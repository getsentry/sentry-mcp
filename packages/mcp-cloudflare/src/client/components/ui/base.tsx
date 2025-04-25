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
      className={cn(
        "text-2xl font-bold mb-6 text-white inline-flex flex-col gap-2 items-center",
        className,
      )}
      {...props}
    >
      {children}
      <span className="block h-[2px] bg-gradient-to-b from-violet-200 to-violet-500 w-full" />
    </Tag>
  );
}

export function Paragraph({
  children,
  className,
  ...props
}: { children: React.ReactNode } & React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("mb-6", className)} {...props}>
      {children}
    </p>
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
