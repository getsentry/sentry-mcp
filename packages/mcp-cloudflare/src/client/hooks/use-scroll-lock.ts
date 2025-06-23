/**
 * Hook to lock body scroll when a component is active
 * Handles edge cases like iOS Safari and nested locks
 */

import { useEffect, useRef } from "react";

// Track active locks to handle nested components
let activeLocks = 0;
let originalStyles: {
  overflow?: string;
  position?: string;
  top?: string;
  width?: string;
} = {};

export function useScrollLock(enabled = true) {
  const scrollPositionRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    // Save scroll position and lock scroll
    const lockScroll = () => {
      // First lock - save original styles
      if (activeLocks === 0) {
        scrollPositionRef.current = window.scrollY;

        originalStyles = {
          overflow: document.body.style.overflow,
          position: document.body.style.position,
          top: document.body.style.top,
          width: document.body.style.width,
        };

        // Apply scroll lock styles
        document.body.style.overflow = "hidden";

        // iOS Safari fix - prevent rubber band scrolling
        if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
          document.body.style.position = "fixed";
          document.body.style.top = `-${scrollPositionRef.current}px`;
          document.body.style.width = "100%";
        }
      }

      activeLocks++;
    };

    // Restore scroll position and unlock
    const unlockScroll = () => {
      activeLocks--;

      // Last lock removed - restore original styles
      if (activeLocks === 0) {
        document.body.style.overflow = originalStyles.overflow || "";
        document.body.style.position = originalStyles.position || "";
        document.body.style.top = originalStyles.top || "";
        document.body.style.width = originalStyles.width || "";

        // Restore scroll position for iOS
        if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
          window.scrollTo(0, scrollPositionRef.current);
        }

        originalStyles = {};
      }
    };

    lockScroll();

    // Cleanup
    return () => {
      unlockScroll();
    };
  }, [enabled]);
}
