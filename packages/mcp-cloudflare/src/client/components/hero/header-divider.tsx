export function HeaderDivider() {
  return (
    <div className="sticky top-[calc(var(--spacing)_*_17_-_1px)] z-50 sm:-mb-64 sm:mt-64 md:-mb-58 md:mt-58 xl:-mb-44 xl:mt-44 2xl:-mb-38 2xl:mt-38 w-full border-b-[1px] border-violet-300/20">
      <div className="absolute top-0 left-(--sidebar-width) -translate-x-[calc(50%+0.5px)] -translate-y-1/2 size-4 border bg-white/5 backdrop-blur border-violet-300/20" />
      <div className="absolute top-0 right-0 sm:right-(--sidebar-width) translate-x-[calc(50%+0.5px)] -translate-y-1/2 size-4 border bg-white/5 backdrop-blur border-violet-300/20" />
    </div>
  );
}
