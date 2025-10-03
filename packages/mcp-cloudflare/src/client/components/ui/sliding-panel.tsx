/**
 * Reusable sliding panel component
 * Handles responsive slide-out behavior
 */

import type { ReactNode } from "react";
import { useScrollLock } from "../../hooks/use-scroll-lock";
import { Button } from "./button";
import { X } from "lucide-react";

interface SlidingPanelProps {
  isOpen: boolean;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
}

export function SlidingPanel({
  isOpen,
  onClose,
  children,
  className = "",
}: SlidingPanelProps) {
  // Lock body scroll when panel is open on mobile
  useScrollLock(isOpen && window.innerWidth < 768);

  return (
    <>
      {/* Mobile: Slide from right */}
      <div
        className={`xl:hidden fixed inset-0 bg-transparent max-w-none max-h-none w-full h-full m-0 p-0 z-40 ${
          isOpen ? "" : "pointer-events-none"
        }`}
      >
        {/* Backdrop */}
        <div
          className={`fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity ${
            isOpen
              ? "opacity-100 pointer-events-auto duration-200"
              : "opacity-0 pointer-events-none duration-300"
          }`}
          onClick={isOpen ? onClose : undefined}
          onKeyDown={
            isOpen ? (e) => e.key === "Escape" && onClose?.() : undefined
          }
          role={isOpen ? "button" : undefined}
          tabIndex={isOpen ? 0 : -1}
          aria-label={isOpen ? "Close panel" : undefined}
        />

        {/* Panel */}
        <div
          className={`fixed inset-y-0 right-0 w-full max-w-2xl bg-background border-l border-slate-800 z-50 shadow-2xl flex flex-col transition-transform duration-500 ease-in-out ${
            isOpen ? "translate-x-0" : "translate-x-full"
          } ${className}`}
        >
          {children}
        </div>
      </div>

      {/* Desktop: placed inside the hero animation container */}
      <div
        className={`${
          isOpen
            ? "xl:flex flex-col blur-none opacity-100 scale-100"
            : "opacity-0 pointer-events-none blur-xl scale-90"
        } absolute top-0 right-0 z-50 max-xl:hidden h-full w-[calc(50%-1rem)] border border-white/10 backdrop-blur-3xl bg-background rounded-3xl transition-all duration-300 overflow-hidden ${className}`}
      >
        <Button
          type="button"
          onClick={onClose}
          size="icon"
          title="Close"
          className="z-50 right-4 top-4 absolute rounded-xl hover:scale-110 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] active:scale-90 active:duration-75 hover:bg-[#201633] hover:text-violet-300 duration-300 transition-all"
        >
          <X className="h-4 w-4" />
        </Button>
        {children}
      </div>
    </>
  );
}
