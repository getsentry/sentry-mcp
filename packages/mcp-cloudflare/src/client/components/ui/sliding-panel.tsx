/**
 * Reusable sliding panel component
 * Handles responsive slide-out behavior
 */

import type { ReactNode } from "react";
import { useScrollLock } from "../../hooks/use-scroll-lock";

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
  useScrollLock(isOpen);

  return (
    <>
      {/* Mobile: Slide from right */}
      <div
        className={`md:hidden fixed inset-0 bg-transparent max-w-none max-h-none w-full h-full m-0 p-0 z-40 ${
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
          className={`fixed inset-y-0 right-0 w-full max-w-2xl bg-slate-950 border-l border-slate-800 z-50 shadow-2xl flex flex-col transition-transform duration-500 ease-in-out ${
            isOpen ? "translate-x-0" : "translate-x-full"
          } ${className}`}
        >
          {children}
        </div>
      </div>

      {/* Desktop: Fixed right half */}
      <div
        className={`${
          isOpen ? "hidden md:flex" : "hidden"
        } fixed top-0 right-0 h-screen w-1/2 bg-slate-950 flex-col border-l border-slate-800 transition-opacity duration-300 ${className}`}
      >
        {children}
      </div>
    </>
  );
}
