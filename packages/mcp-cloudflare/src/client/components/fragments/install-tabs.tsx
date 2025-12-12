"use client";

import * as React from "react";
import { Prose } from "../ui/prose";
import { cn } from "@/client/lib/utils";
import { GeminiIcon } from "../ui/icons/gemini";
import { ChevronRight } from "lucide-react";

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
          className="flex max-w-full overflow-x-auto hide-scrollbar overflow-y-visible pt-8 pb-4 -mb-4 -mt-8 relative [--r:1rem] [--2r:2rem] [--t:3rem] [mask:radial-gradient(circle_at_calc(100%-var(--r))_var(--t),green_var(--r),transparent_var(--r)),radial-gradient(circle_at_var(--2r)_var(--r),blue_var(--r),transparent_var(--r)),radial-gradient(circle_at_calc(100%-var(--2r))_var(--r),green_var(--r),transparent_var(--r)),linear-gradient(to_right,red_calc(100%-var(--r)),transparent_calc(100%-var(--r))),linear-gradient(to_bottom,transparent,transparent_var(--t),red_var(--t))] pr-20"
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
  cursor: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      version="1.1"
      className="size-4"
      viewBox="0 0 466.73 532.09"
      aria-hidden="true"
    >
      <path
        className="fill-current"
        d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75,3.32,9.3,9.46,9.3,16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z"
      />
    </svg>
  ),
  "claude-code": (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className="fill-current"
    >
      <title>Claude</title>
      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
    </svg>
  ),
  "codex-cli": (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className="fill-current"
    >
      <title>OpenAI</title>
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  ),
  windsurf: (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className="fill-current"
    >
      <title>Windsurf</title>
      <path d="M23.55 5.067c-1.2038-.002-2.1806.973-2.1806 2.1765v4.8676c0 .972-.8035 1.7594-1.7597 1.7594-.568 0-1.1352-.286-1.4718-.7659l-4.9713-7.1003c-.4125-.5896-1.0837-.941-1.8103-.941-1.1334 0-2.1533.9635-2.1533 2.153v4.8957c0 .972-.7969 1.7594-1.7596 1.7594-.57 0-1.1363-.286-1.4728-.7658L.4076 5.1598C.2822 4.9798 0 5.0688 0 5.2882v4.2452c0 .2147.0656.4228.1884.599l5.4748 7.8183c.3234.462.8006.8052 1.3509.9298 1.3771.313 2.6446-.747 2.6446-2.0977v-4.893c0-.972.7875-1.7593 1.7596-1.7593h.003a1.798 1.798 0 0 1 1.4718.7658l4.9723 7.0994c.4135.5905 1.05.941 1.8093.941 1.1587 0 2.1515-.9645 2.1515-2.153v-4.8948c0-.972.7875-1.7594 1.7596-1.7594h.194a.22.22 0 0 0 .2204-.2202v-4.622a.22.22 0 0 0-.2203-.2203Z" />
    </svg>
  ),
  vscode: (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="fill-current"
    >
      <title>Code</title>
      <g clipPath="url(#clip0)">
        <g filter="url(#filter0_d)">
          <g mask="url(#mask0)">
            <path d="M96.4614 10.593L75.8567 0.62085C73.4717 -0.533437 70.6215 -0.0465506 68.7498 1.83492L1.29834 63.6535C-0.515935 65.3164 -0.513852 68.1875 1.30281 69.8476L6.8125 74.8823C8.29771 76.2395 10.5345 76.339 12.1335 75.1201L93.3604 13.18C96.0854 11.102 100 13.0557 100 16.4939V16.2535C100 13.84 98.6239 11.64 96.4614 10.593Z" />
            <g filter="url(#filter1_d)">
              <path d="M96.4614 89.4074L75.8567 99.3797C73.4717 100.534 70.6215 100.047 68.7498 98.1651L1.29834 36.3464C-0.515935 34.6837 -0.513852 31.8125 1.30281 30.1524L6.8125 25.1177C8.29771 23.7605 10.5345 23.6606 12.1335 24.88L93.3604 86.8201C96.0854 88.8985 100 86.9447 100 83.5061V83.747C100 86.1604 98.6239 88.3603 96.4614 89.4074Z" />
            </g>
            <g filter="url(#filter2_d)">
              <path d="M75.8578 99.3807C73.4721 100.535 70.6219 100.047 68.75 98.1651C71.0564 100.483 75 98.8415 75 95.5631V4.43709C75 1.15852 71.0565 -0.483493 68.75 1.83492C70.6219 -0.0467614 73.4721 -0.534276 75.8578 0.618963L96.4583 10.5773C98.6229 11.6237 100 13.8246 100 16.2391V83.7616C100 86.1762 98.6229 88.3761 96.4583 89.4231L75.8578 99.3807Z" />
            </g>
            <g>
              <path
                opacity="0.25"
                fillRule="evenodd"
                clipRule="evenodd"
                d="M70.8508 99.5723C72.4258 100.189 74.2218 100.15 75.8115 99.3807L96.4 89.4231C98.5635 88.3771 99.9386 86.1762 99.9386 83.7616V16.2391C99.9386 13.8247 98.5635 11.6239 96.4 10.5774L75.8115 0.618974C73.7252 -0.390085 71.2835 -0.142871 69.4525 1.19518C69.1909 1.38637 68.9418 1.59976 68.7079 1.83493L29.2941 37.9795L12.1261 24.88C10.528 23.6606 8.2926 23.7605 6.80833 25.1177L1.30198 30.1524C-0.51354 31.8126 -0.515625 34.6837 1.2975 36.3465L16.186 50L1.2975 63.6536C-0.515625 65.3164 -0.51354 68.1875 1.30198 69.8476L6.80833 74.8824C8.2926 76.2395 10.528 76.339 12.1261 75.1201L29.2941 62.0207L68.7079 98.1651C69.3315 98.7923 70.0635 99.2645 70.8508 99.5723ZM74.9542 27.1812L45.0481 50L74.9542 72.8188V27.1812Z"
                fill="url(#paint0_linear)"
              />
            </g>
          </g>
        </g>
      </g>
    </svg>
  ),
  warp: (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className="fill-current"
    >
      <title>Warp</title>
      <path d="M12.035 2.723h9.253A2.712 2.712 0 0 1 24 5.435v10.529a2.712 2.712 0 0 1-2.712 2.713H8.047Zm-1.681 2.6L6.766 19.677h5.598l-.399 1.6H2.712A2.712 2.712 0 0 1 0 18.565V8.036a2.712 2.712 0 0 1 2.712-2.712Z" />
    </svg>
  ),
  zed: (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className="fill-current"
    >
      <title>Zed Industries</title>
      <path d="M2.25 1.5a.75.75 0 0 0-.75.75v16.5H0V2.25A2.25 2.25 0 0 1 2.25 0h20.095c1.002 0 1.504 1.212.795 1.92L10.764 14.298h3.486V12.75h1.5v1.922a1.125 1.125 0 0 1-1.125 1.125H9.264l-2.578 2.578h11.689V9h1.5v9.375a1.5 1.5 0 0 1-1.5 1.5H5.185L2.562 22.5H21.75a.75.75 0 0 0 .75-.75V5.25H24v16.5A2.25 2.25 0 0 1 21.75 24H1.655C.653 24 .151 22.788.86 22.08L13.19 9.75H9.75v1.5h-1.5V9.375A1.125 1.125 0 0 1 9.375 8.25h5.314l2.625-2.625H5.625V15h-1.5V5.625a1.5 1.5 0 0 1 1.5-1.5h13.19L21.438 1.5z" />
    </svg>
  ),
  gemini: <GeminiIcon className="size-4" />,
};
