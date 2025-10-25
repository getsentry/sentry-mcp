export function HeaderDivider() {
  return (
    <div className="sticky top-17 z-30 sm:-mb-64 sm:mt-64 md:-mb-58 md:mt-58 xl:-mb-44 xl:mt-44 2xl:-mb-38 2xl:mt-38 w-screen border-b-[1px] border-violet-300/20 [--x:0] sm:[--x:40rem] md:[--x:48rem] lg:[--x:64rem] xl:[--x:80rem] 2xl:[--x:96rem]">
      <div className="absolute top-0 left-[calc((100vw-var(--x))/2)] -translate-x-[calc(50%+0.5px)] -translate-y-1/2 h-4 w-4 border bg-white/5 backdrop-blur border-violet-300/20" />
      <div className="absolute top-0 right-[calc((100vw-var(--x))/2)] translate-x-[calc(50%+0.5px)] -translate-y-1/2 h-4 w-4 border bg-white/5 backdrop-blur border-violet-300/20" />
    </div>
  );
}
