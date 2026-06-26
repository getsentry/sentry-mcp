"use client";
import { Search, SearchCheck, SearchCode, SearchX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export default function ErrorListWithCursorFollower() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const followerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const mousePosRef = useRef({ x: 0, y: 0, visible: false });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    const follower = followerRef.current;
    if (!el || !follower) return;

    const update = () => {
      const { x, y, visible } = mousePosRef.current;
      follower.style.opacity = visible ? "1" : "0";
      follower.style.transform = `translate(${x}px, ${y}px)`;
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const handleMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 12;
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    x = Math.max(pad, Math.min(rect.width - pad, x));
    y = Math.max(pad, Math.min(rect.height - pad, y));
    mousePosRef.current = { x, y, visible: true };
  };

  const handleEnter = () => {
    mousePosRef.current.visible = true;
  };
  const handleLeave = () => {
    mousePosRef.current.visible = false;
    setHoverIdx(null);
  };

  const onEnterRow = (idx: number) => () => setHoverIdx(idx);
  const onLeaveRow = () => setHoverIdx(null);

  const iconBase =
    "absolute inset-0 size-8 stroke-[1px] transition-opacity duration-200 text-white/80";

  return (
    <div
      ref={containerRef}
      onMouseEnter={handleEnter}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className="relative mb-auto [mask-image:linear-gradient(to_bottom,rgba(0,0,0,1)_60%,rgba(0,0,0,0)_100%)] flex flex-col cursor-none [*]:cursor-none select-none"
    >
      {/* follower (on top) */}
      <div
        ref={followerRef}
        className="pointer-events-none absolute top-0 left-0 z-50 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/5 backdrop-blur-sm transition-opacity duration-150 will-change-transform flex items-center justify-center [mask-image:radial-gradient(circle,rgba(0,0,0,1)_40%,rgba(0,0,0,0)_70%)]"
        style={{ opacity: 0 }}
      >
        {/* icon stack wrapper gets remounted on switch to retrigger pop */}
        <div key={hoverIdx ?? -1} className="relative size-8 pop">
          <Search
            className={`${iconBase} ${
              hoverIdx === null || hoverIdx === 0 ? "opacity-100" : "opacity-0"
            }`}
            aria-hidden={!(hoverIdx === null || hoverIdx === 0)}
          />
          <SearchX
            className={`${iconBase} !text-[#fd918f] ${
              hoverIdx === 1 ? "opacity-100" : "opacity-0"
            }`}
            aria-hidden={hoverIdx !== 1}
          />
          <SearchCode
            className={`${iconBase} !text-violet-300 ${
              hoverIdx === 2 ? "opacity-100" : "opacity-0"
            }`}
            aria-hidden={hoverIdx !== 2}
          />
          <SearchCheck
            className={`${iconBase} !text-lime-300 ${
              hoverIdx === 3 ? "opacity-100" : "opacity-0"
            }`}
            aria-hidden={hoverIdx !== 3}
          />
        </div>
      </div>

      {/* rows */}
      <div
        onMouseEnter={onEnterRow(0)}
        onMouseLeave={onLeaveRow}
        className="border-y-[0.5px] border-x h-12 w-full border-white/10 bg-background-2 duration-300 hover:bg-background-3 delay-150 translate-y-4 group-hover:translate-y-0 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] p-4 pb-10 hover:delay-0 hover:duration-0 items-center rounded-t-xl"
      >
        Error&nbsp;<span className="opacity-50">call(components/Checkout)</span>
      </div>
      <div
        onMouseEnter={onEnterRow(1)}
        onMouseLeave={onLeaveRow}
        className="border-y-[0.5px] border-x h-12 w-full border-white/10 bg-background-2 duration-300 hover:bg-background-3 delay-100 translate-y-4 group-hover:translate-y-0 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] p-4 pb-10 hover:delay-0 hover:duration-0 items-center"
      >
        SyntaxError&nbsp;<span className="opacity-50">json([native code])</span>
      </div>
      <div
        onMouseEnter={onEnterRow(2)}
        onMouseLeave={onLeaveRow}
        className="border-y-[0.5px] border-x h-12 w-full border-white/10 bg-background-2 duration-300 hover:bg-background-3 delay-50 translate-y-4 group-hover:translate-y-0 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] p-4 pb-10 hover:delay-0 hover:duration-0 items-center"
      >
        TypeError&nbsp;
        <span className="opacity-50">notAFunctionError(utils/errors)</span>
      </div>
      <div
        onMouseEnter={onEnterRow(3)}
        onMouseLeave={onLeaveRow}
        className="border-y-[0.5px] border-x h-12 w-full border-white/10 bg-background-2 duration-300 hover:bg-background-3 delay-0 translate-y-4 group-hover:translate-y-0 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] p-4 pb-10 hover:delay-0 hover:duration-0 items-center"
      >
        ReferenceError&nbsp;
        <span className="opacity-50">referenceError(utils/errors)</span>
      </div>
    </div>
  );
}
