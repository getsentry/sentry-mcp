"use client";
import { useEffect, useRef, useState } from "react";

type TocSection = { name: string; id: string; active: boolean };

export default function TableOfContents() {
  const [sections, setSections] = useState<TocSection[]>([
    { name: "Getting Started", id: "getting-started", active: true },
    // { name: "Integration Guides", id: "integration-guides", active: false },
    { name: "Available Tools", id: "tools", active: false },
    // { name: "Available Prompts", id: "prompts", active: false },
    // { name: "Available Resources", id: "resources", active: false },
    { name: "More Information", id: "more-information", active: false },
  ]);

  // live set of elements currently intersecting
  const inViewRef = useRef<Set<HTMLElement>>(new Set());
  const rafRef = useRef<number | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const currentActiveIdRef = useRef<string | null>(null);

  useEffect(() => {
    const biasPx = 6; // tiny bias so a section "counts" as soon as it peeks in
    const computeAndSetActive = () => {
      if (inViewRef.current.size === 0) return;

      let bottomMost: HTMLElement | null = null;
      let maxTop = Number.NEGATIVE_INFINITY;
      const vh = window.innerHeight;

      // biome-ignore lint/complexity/noForEach: <explanation: vibes>
      inViewRef.current.forEach((el) => {
        const r = el.getBoundingClientRect();
        // truly visible in viewport (with a small bias)
        const visible = r.bottom > biasPx && r.top < vh - biasPx;
        if (!visible) return;

        // pick the one closest to the bottom of the viewport
        if (r.top > maxTop) {
          maxTop = r.top;
          bottomMost = el as HTMLElement;
        }
      });

      if (!bottomMost) return;

      const id = (bottomMost as HTMLElement).id;
      if (id === currentActiveIdRef.current) return; // skip redundant state updates
      currentActiveIdRef.current = id;

      setSections((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, active: true } : { ...s, active: false },
        ),
      );
    };

    const cb: IntersectionObserverCallback = (entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          inViewRef.current.add(el);
        } else {
          inViewRef.current.delete(el);
        }
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(computeAndSetActive);
    };

    observerRef.current = new IntersectionObserver(cb, {
      root: null,
      rootMargin: "-120px 0px 0px 0px",
      threshold: 0,
    });

    const els = Array.from(
      document.querySelectorAll<HTMLElement>("section[id]"),
    );
    // biome-ignore lint/complexity/noForEach: <explanation: vibes>
    els.forEach((el) => observerRef.current!.observe(el));

    // initial calculation on load/refresh
    requestAnimationFrame(() => {
      const vh = window.innerHeight;
      // biome-ignore lint/complexity/noForEach: <explanation: vibes>
      els.forEach((el) => {
        const r = el.getBoundingClientRect();
        const visible = r.bottom > biasPx && r.top < vh - biasPx;
        if (visible) inViewRef.current.add(el);
      });
      computeAndSetActive();
    });

    return () => {
      if (observerRef.current) {
        // biome-ignore lint/complexity/noForEach: <explanation: vibes>
        els.forEach((el) => observerRef.current!.unobserve(el));
        observerRef.current.disconnect();
      }
      observerRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      inViewRef.current.clear();
    };
  }, []); // run once

  return (
    <div className="group pointer-events-none sticky top-20 px-12 text-white/60">
      <div className="pointer-events-auto flex flex-col py-2">
        <b className="-ml-5 mb-2 font-mono text-xs text-white">
          [table of contents]
        </b>
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            onClick={(e) => {
              e.preventDefault();
              document
                .getElementById(section.id)
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
              // preserve current query string, only change the hash
              const url = new URL(window.location.href);
              url.hash = section.id;
              window.history.pushState(
                window.history.state,
                "",
                url.toString(),
              );
            }}
            className={`-ml-[calc(1rem+1px)] border-l py-1.5 pl-3 duration-75 max-xl:lg:opacity-20 max-xl:lg:group-hover:opacity-100 ${
              section.active
                ? "border-violet-300 text-violet-300"
                : "border-neutral-400/30 hover:border-white hover:text-white"
            }`}
          >
            {section.name}
          </a>
        ))}
      </div>
    </div>
  );
}
