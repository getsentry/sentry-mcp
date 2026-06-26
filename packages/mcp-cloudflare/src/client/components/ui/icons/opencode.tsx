import { cn } from "@/client/lib/utils";

export function OpenCodeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={cn("fill-current size-4", className)}
      aria-hidden="true"
    >
      <path d="M320 224V352H192V224H320Z" className="opacity-60" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"
      />
    </svg>
  );
}
