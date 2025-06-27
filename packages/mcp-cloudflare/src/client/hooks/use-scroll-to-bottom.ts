/**
 * Hook to automatically scroll to bottom of a container with smart user scroll detection
 * Used for chat interfaces and log viewers
 */

import { useEffect, useRef, useCallback, useState } from "react";

interface UseScrollToBottomOptions {
  /** Delay before scrolling (ms) */
  delay?: number;
  /** Whether to enable auto-scroll initially */
  initialAutoScroll?: boolean;
}

export function useScrollToBottom<T extends HTMLElement>(
  options: UseScrollToBottomOptions = {},
) {
  const { delay = 0, initialAutoScroll = true } = options;

  const containerRef = useRef<T>(null);
  const timeoutRef = useRef<number | undefined>(undefined);
  const lastScrollHeight = useRef(0);
  const hasInitialScrolled = useRef(false);

  // Track auto-scroll state - can be controlled externally
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(initialAutoScroll);

  // Check if user is near bottom of scroll container
  const isNearBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return false;

    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollTop + clientHeight >= scrollHeight - 100; // 100px threshold
  }, []);

  // Manual scroll to bottom function
  const scrollToBottom = useCallback((forceInstant?: boolean) => {
    const container = containerRef.current;
    if (!container) return;

    const scrollOptions: ScrollToOptions = {
      top: container.scrollHeight,
      behavior: forceInstant ? "auto" : "smooth",
    };

    container.scrollTo(scrollOptions);
    lastScrollHeight.current = container.scrollHeight;
  }, []);

  // Auto-scroll with delay when needed
  const autoScrollToBottom = useCallback(() => {
    if (!autoScrollEnabled) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (delay > 0) {
      timeoutRef.current = window.setTimeout(() => scrollToBottom(), delay);
    } else {
      scrollToBottom();
    }
  }, [autoScrollEnabled, scrollToBottom, delay]);

  // Handle initial scroll when container first gets content
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Check if we have content but haven't scrolled yet
    if (
      container.scrollHeight > container.clientHeight &&
      !hasInitialScrolled.current
    ) {
      hasInitialScrolled.current = true;
      // Instant scroll on initial load
      scrollToBottom(true);
    }
  });

  // Set up scroll listener to detect user scrolling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const nearBottom = isNearBottom();

      // Update auto-scroll state based on scroll position
      setAutoScrollEnabled(nearBottom);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });

    // Check initial state
    handleScroll();

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [isNearBottom]);

  // Monitor content changes with MutationObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new MutationObserver(() => {
      const newScrollHeight = container.scrollHeight;

      // If content height changed and we should auto-scroll, do it
      if (newScrollHeight !== lastScrollHeight.current && autoScrollEnabled) {
        autoScrollToBottom();
      }

      lastScrollHeight.current = newScrollHeight;
    });

    // Observe the container and all its descendants for content changes
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: false, // Don't watch attributes to avoid style changes
    });

    // Set initial scroll height
    lastScrollHeight.current = container.scrollHeight;

    return () => {
      observer.disconnect();
    };
  }, [autoScrollToBottom, autoScrollEnabled]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return [containerRef, scrollToBottom, setAutoScrollEnabled] as const;
}
