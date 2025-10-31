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
  useScrollLock(isOpen && window.innerWidth < 768);

  return (
    <div className="fixed inset-0 bg-transparent max-w-none max-h-none w-full h-full z-50 pointer-events-none">
      {/* Backdrop */}
      <div
        className={`fixed xl:hidden inset-0 bg-black/50 backdrop-blur-sm transition-opacity ${
          isOpen
            ? "opacity-100 pointer-events-auto duration-200"
            : "opacity-0 select-none pointer-events-none duration-300"
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
        className={`fixed xl:hidden inset-y-0 right-0 w-full max-w-2xl bg-background-3 border-l border-slate-800 z-50 shadow-2xl flex flex-col ease-out motion-safe:duration-300 ${
          isOpen
            ? "translate-x-0 pointer-events-auto"
            : "translate-x-full pointer-events-none"
        } ${className}`}
      >
        {children}
      </div>
      <div
        className={`fixed hidden xl:flex inset-y-0 right-0 w-full max-w-[50vw] bg-background-2 flex-col ease-out ${
          isOpen
            ? "translate-x-0 blur-none scale-100 opacity-100 pointer-events-auto motion-safe:duration-300 delay-150 transition-[opacity,filter,scale]"
            : "translate-x-full blur-xl motion-safe:scale-90 opacity-0 pointer-events-none duration-0"
        } ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
