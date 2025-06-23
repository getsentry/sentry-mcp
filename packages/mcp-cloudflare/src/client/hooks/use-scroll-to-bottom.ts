/**
 * Hook to automatically scroll to bottom of a container
 * Used for chat interfaces and log viewers
 */

import { useEffect, useRef, useCallback } from "react";

interface UseScrollToBottomOptions {
  /** Enable/disable auto-scrolling */
  enabled?: boolean;
  /** Smooth scroll animation */
  smooth?: boolean;
  /** Debounce delay in ms */
  delay?: number;
  /** Dependencies that trigger scroll */
  dependencies?: any[];
}

export function useScrollToBottom<T extends HTMLElement>(
  options: UseScrollToBottomOptions = {},
) {
  const {
    enabled = true,
    smooth = true,
    delay = 0,
    dependencies = [],
  } = options;

  const containerRef = useRef<T>(null);
  const timeoutRef = useRef<number | undefined>(undefined);

  const scrollToBottom = useCallback(() => {
    if (!containerRef.current || !enabled) return;

    const scrollOptions: ScrollToOptions = {
      top: containerRef.current.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    };

    containerRef.current.scrollTo(scrollOptions);
  }, [enabled, smooth]);

  const scrollToBottomWithDelay = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (delay > 0) {
      timeoutRef.current = window.setTimeout(scrollToBottom, delay);
    } else {
      scrollToBottom();
    }
  }, [scrollToBottom, delay]);

  // Scroll when dependencies change
  useEffect(() => {
    scrollToBottomWithDelay();
  }, [...dependencies, scrollToBottomWithDelay]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    containerRef,
    scrollToBottom,
    scrollToBottomWithDelay,
  };
}
