"use client";

import * as React from "react";
import { Prose } from "../ui/prose";
import { cn } from "@/client/lib/utils";
import { ChevronRight } from "lucide-react";
import { GeminiIcon } from "../ui/icons/gemini";
import { ZedIcon } from "../ui/icons/zed";
import { WarpIcon } from "../ui/icons/warp";
import { VSCodeIcon } from "../ui/icons/vscode";
import { WindsurfIcon } from "../ui/icons/windsurf";
import { CodexIcon } from "../ui/icons/codex";
import { ClaudeIcon } from "../ui/icons/claude";
import { CursorIcon } from "../ui/icons/cursor";

export type TabProps = {
  id: string;
  title: string;
  children: React.ReactNode;
};
export function Tab(_props: TabProps) {
  return null;
}

export default function InstallTabs({
  children,
  initialIndex = 0,
  current,
  onChange,
  className = "",
}: {
  children: React.ReactNode;
  initialIndex?: number;
  current?: number;
  onChange?: (next: number) => void;
  className?: string;
}) {
  const items = React.Children.toArray(children).filter(
    React.isValidElement,
  ) as React.ReactElement<TabProps>[];

  const [internal, setInternal] = React.useState(initialIndex);
  const active = typeof current === "number" ? current : internal;

  const setActive = React.useCallback(
    (next: number) => {
      if (next < 0 || next >= items.length) return;
      if (typeof current === "number") onChange?.(next);
      else {
        setInternal(next);
        onChange?.(next);
      }
    },
    [current, items.length, onChange],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!items.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      setActive((active + 1) % items.length);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((active - 1 + items.length) % items.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(items.length - 1);
    }
  };

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const panelRefs = React.useRef<(HTMLDivElement | null)[]>([]);

  React.useLayoutEffect(() => {
    const c = containerRef.current;
    const p = panelRefs.current[active];
    if (c && p) c.style.height = `${p.offsetHeight}px`;
  }, [active]);

  React.useEffect(() => {
    const c = containerRef.current;
    const next = panelRefs.current[active];
    if (!c || !next) return;
    const from = c.offsetHeight;
    const to = next.offsetHeight;
    c.style.height = `${from}px`;
    c.offsetHeight;
    c.style.transition = "height 300ms cubic-bezier(0.2, 0.8, 0.2, 1)";
    c.style.height = `${to}px`;
    const done = () => {
      c.style.transition = "";
    };
    c.addEventListener("transitionend", done, { once: true });
  }, [active]);

  React.useEffect(() => {
    const c = containerRef.current;
    const p = panelRefs.current[active];
    if (!c || !p) return;
    const ro = new ResizeObserver(() => {
      c.style.height = `${p.offsetHeight}px`;
    });
    ro.observe(p);
    return () => ro.disconnect();
  }, [active]);

  const navRef = React.useRef<HTMLDivElement | null>(null);

  const startAutoScroll = React.useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    // if already at (or very near) the end, do nothing
    if (el.scrollLeft >= max - 1) return;
    el.scrollTo({ left: max, behavior: "smooth" });
  }, []);

  return (
    <div className={cn("relative bg-background-2 rounded-2xl", className)}>
      <div
        className="flex"
        role="tablist"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
      >
        {/* [mask:radial-gradient(circle_at_var(--r)_var(--t),blue_var(--r),transparent_var(--r)),radial-gradient(circle_at_calc(100%-var(--r))_var(--t),green_var(--r),transparent_var(--r)),radial-gradient(circle_at_var(--2r)_var(--r),blue_var(--r),transparent_var(--r)),radial-gradient(circle_at_calc(100%-var(--2r))_var(--r),green_var(--r),transparent_var(--r)),linear-gradient(to_right,transparent,transparent_var(--r),red_var(--r),red_calc(100%-var(--r)),transparent_calc(100%-var(--r))),linear-gradient(to_bottom,transparent,transparent_var(--t),red_var(--t))] */}
        <div
          ref={navRef}
          // flex has a min-width-contents by default causing a blowout of container width in getting-started.tsx, or wherever used, so w-0 is used to fix that, and flex-1 makes it fill the space like w-full would
          className="flex min-w-0 w-0 flex-1 overflow-x-auto hide-scrollbar overflow-y-visible pt-8 pb-4 -mb-4 -mt-8 relative [--r:1rem] [--2r:2rem] [--t:3rem] [mask:radial-gradient(circle_at_calc(100%-var(--r))_var(--t),green_var(--r),transparent_var(--r)),radial-gradient(circle_at_var(--2r)_var(--r),blue_var(--r),transparent_var(--r)),radial-gradient(circle_at_calc(100%-var(--2r))_var(--r),green_var(--r),transparent_var(--r)),linear-gradient(to_right,red_calc(100%-var(--r)),transparent_calc(100%-var(--r))),linear-gradient(to_bottom,transparent,transparent_var(--t),red_var(--t))] pr-20"
        >
          {items.map((el, i) => {
            const { id, title } = el.props;
            const selected = i === active;
            const lastIdx = items.length - 1;
            const tabId = `${id}-tab`;
            const panelId = `${id}-panel`;
            return (
              <button
                type="button"
                key={id}
                id={tabId}
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(i)}
                className="relative group/tab cursor-pointer"
              >
                {i > 0 && !selected && (
                  <>
                    <div className="group-hover/tab:scale-100 group-active/tab:duration-75 group-active/tab:scale-0 group-hover/tab:duration-200 duration-0 scale-0 absolute left-1 -translate-x-full -top-2 size-3 bg-background-2 origin-bottom-right" />
                    <div className="group-hover/tab:scale-100 group-active/tab:duration-75 group-active/tab:scale-0 group-hover/tab:duration-200 duration-0 scale-0 absolute left-0 -translate-x-full -top-0 -translate-y-full size-4 rounded-full bg-background origin-bottom-right" />
                  </>
                )}
                <div className="absolute inset-[0.5px] bottom-3 bg-orange-300 bg-[repeating-linear-gradient(-45deg,#f97316,#f97316_12px,#f9731600_12px,#f9731600_24px)] rounded-xl z-0 group-active/tab:duration-75 group-active/tab:opacity-0 duration-300 group-active/tab:translate-y-2 group-active/tab:scale-90" />
                <div
                  className={`absolute inset-[0.5px] bottom-1 duration-300 bg-pink-600 bg-grid [--size:10px] rounded-xl z-0 group-active/tab:duration-75 group-active/tab:opacity-50 group-active/tab:scale-x-95 group-active/tab:translate-y-0.5 group-active/tab:scale-y-115 group-active/tab:bg-violet-600 group-active/tab:ease-[cubic-bezier(0.175,0.885,0.32,1.275)] ${
                    selected
                      ? ""
                      : "group-hover/tab:-translate-y-4 group-hover/tab:duration-400 group-hover/tab:ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"
                  }`}
                />
                <div
                  className={`bg-background-2 relative rounded-xl py-4 pr-5 pl-6 duration-300 perspective-distant text-nowrap flex items-center overflow-hidden gap-2 group-active/tab:duration-100 group-active/tab:rotate-x-5 group-active/tab:translate-y-1.5 group-active/tab:text-violet-500 z-10 ${
                    selected
                      ? "text-violet-300 underline"
                      : "group-hover/tab:text-violet-300 group-hover/tab:underline group-hover/tab:-rotate-x-45 group-hover/tab:-translate-y-6.5 group-hover/tab:ease-[cubic-bezier(0.175,0.885,0.32,1.275)] group-active/tab:scale-[0.95]"
                  }`}
                >
                  {/* unfinished: soft glow effect */}
                  {/* <div className="absolute top-0 left-1/2 -translate-1/2 w-20 h-6 duration-300 group-hover/tab:bg-violet-400/50 rounded-[100%] blur-lg -z-10 pointer-events-none" /> */}
                  {iconsByID[id] && (
                    <span
                      className="size-4 -ml-2 grid place-items-center"
                      aria-hidden="true"
                    >
                      {iconsByID[id]}
                    </span>
                  )}
                  {/* desktop - show title by default */}
                  <span className="truncate hidden md:block">{title}</span>
                  {/* mobile - hide title by default, show when selected */}
                  <span className="md:hidden contents">
                    {selected && title}
                  </span>
                </div>
                {i < lastIdx && !selected && (
                  <>
                    <div className="group-hover/tab:scale-100 group-active/tab:duration-75 group-active/tab:scale-0 group-hover/tab:duration-200 duration-0 scale-0 absolute right-1 translate-x-full -top-2 size-3 bg-background-2 origin-bottom-left" />
                    <div className="group-hover/tab:scale-100 group-active/tab:duration-75 group-active/tab:scale-0 group-hover/tab:duration-200 duration-0 scale-0 absolute right-0 translate-x-full -top-0 -translate-y-full size-4 rounded-full bg-background origin-bottom-left" />
                  </>
                )}
              </button>
            );
          })}
        </div>
        <div
          className="absolute top-0 right-0 h-14 w-20 bg-gradient-to-l from-background-2 to-transparent rounded-tr-2xl z-10 group/scroller"
          onMouseEnter={startAutoScroll}
        >
          <ChevronRight className="absolute top-1/2 -translate-y-1/2 right-1 size-5 group-hover/scroller:scale-y-75 group-hover/scroller:scale-x-125 duration-300" />
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative transition-[height] delay-500 duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] overflow-hidden"
      >
        {items.map((el, i) => {
          const { id, children: panelChildren } = el.props;
          const panelId = `${id}-panel`;
          const tabId = `${id}-tab`;
          const selected = i === active;
          const pos = i === active ? "current" : i < active ? "left" : "right";
          return (
            <div
              key={id}
              ref={(node) => {
                panelRefs.current[i] = node;
              }}
              id={panelId}
              role="tabpanel"
              aria-labelledby={tabId}
              aria-hidden={!selected}
              data-pos={pos}
              data-idx={i}
              data-current={active}
              className={`duration-400 ${
                selected
                  ? "visible opacity-100 blur-none"
                  : `invisible opacity-0 blur-xl motion-safe:scale-x-110 motion-safe:scale-y-90 absolute top-0 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] ${
                      i < active
                        ? "motion-safe:-translate-x-1/4"
                        : "motion-safe:translate-x-1/4"
                    }`
              }`}
            >
              <Prose className="p-4 pt-0">{panelChildren}</Prose>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const iconsByID: Record<string, React.ReactNode> = {
  cursor: <CursorIcon />,
  "claude-code": <ClaudeIcon />,
  "codex-cli": <CodexIcon />,
  windsurf: <WindsurfIcon />,
  vscode: <VSCodeIcon />,
  warp: <WarpIcon />,
  zed: <ZedIcon />,
  gemini: <GeminiIcon className="size-4" />,
};
