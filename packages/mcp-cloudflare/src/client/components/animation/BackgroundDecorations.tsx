export default function () {
  return (
    <>
      {/* <div className="bg-[radial-gradient(ellipse_110%_100%_at_top_right,transparent_80%,#8d5596_95%,transparent)] absolute inset-0 -z-10 h-screen w-full opacity-100 [filter:url(#nnnoise-darken)] pointer-events-none" /> */}
      {/* <div className="hidden md:block bg-[#201633] absolute top-0 right-0 translate-x-1/2 -translate-y-1/2 rounded-full h-[100vh] w-[100vh] blur-3xl pointer-events-none -z-10" />
      <div className="hidden md:block bg-[#201633] absolute top-0 right-0 translate-x-1/2 -translate-y-1/2 rounded-full h-[150vh] w-[150vh] opacity-50 blur-3xl pointer-events-none -z-10" />
      <div className="hidden md:block bg-[#201633] absolute top-0 right-0 translate-x-1/2 -translate-y-1/2 rounded-full h-[200vh] w-[200vh] opacity-50 blur-3xl pointer-events-none -z-10" /> */}
      {/* <div className="bg-[#201633] absolute top-0 right-0 translate-x-1/2 -translate-y-1/2 rounded-full h-[100vh] w-[100vh] blur-3xl pointer-events-none -z-10 [filter:url(#nnnoise-darken)] [mask-image:radial-gradient(circle_at_center,red_50%,transparent_69%)]" />
      <div className="bg-[#201633] absolute top-0 right-0 translate-x-1/2 -translate-y-1/2 rounded-full h-[150vh] w-[150vh] opacity-50 blur-3xl pointer-events-none -z-10 [filter:url(#nnnoise-darken)] [mask-image:radial-gradient(circle_at_center,red_50%,transparent_69%)]" />
      <div className="bg-[#201633] absolute top-0 right-0 translate-x-1/2 -translate-y-1/2 rounded-full h-[200vh] w-[200vh] opacity-50 blur-3xl pointer-events-none -z-10 [filter:url(#nnnoise-darken)] [mask-image:radial-gradient(circle_at_center,red_50%,transparent_69%)]" /> */}
      {/* <div className="bg-[#8b5395] absolute top-0 right-0 translate-x-1/2 -translate-y-1/2 rounded-full h-[50vh] w-[50vh] pointer-events-none -z-10 blur-3xl" /> */}
      {/* <div className="bg-[radial-gradient(ellipse_110%_100%_at_top_right,transparent_40%,#bf5c7f_50%,transparent_60%)] absolute inset-0 -z-10 h-screen w-full opacity-50 [filter:url(#nnnoise-darken)]" /> */}

      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="0"
        height="0"
        aria-hidden="true"
      >
        <defs>
          <filter
            id="nnnoise-darken-fine"
            filterUnits="objectBoundingBox"
            primitiveUnits="objectBoundingBox"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
            colorInterpolationFilters="linearRGB"
          >
            {/* <!-- 1) Fine monochrome noise --> */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.69"
              numOctaves="1"
              seed="9"
              result="noise"
            />
            <feColorMatrix in="noise" type="saturate" values="0" result="g" />

            {/* <!-- 2) Shape the noise -> mostly near 0 with occasional spikes (speckles) --> */}
            {/* <!--    gamma < 1 = more speckles; > 1 = fewer --> */}
            <feComponentTransfer in="g" result="mask">
              <feFuncR type="gamma" amplitude="1" exponent="0.65" offset="0" />
              <feFuncG type="gamma" amplitude="1" exponent="0.65" offset="0" />
              <feFuncB type="gamma" amplitude="1" exponent="0.65" offset="0" />
            </feComponentTransfer>

            {/* <!-- 3) Keep noise only where the element is opaque (transparent areas stay clean) --> */}
            <feComposite
              in="mask"
              in2="SourceAlpha"
              operator="in"
              result="maskedNoise"
            />

            {/* <!-- 4) Darken-only: out = SourceGraphic * (1 - strength * maskedNoise) --> */}
            {/* <!--    arithmetic: k1=-strength, k2=1, k3=0, k4=0 --> */}
            <feComposite
              in="SourceGraphic"
              in2="maskedNoise"
              operator="arithmetic"
              k1="-1"
              k2="1"
              k3="0"
              k4="0"
            />
          </filter>
          <filter
            id="nnnoise-darken"
            filterUnits="objectBoundingBox"
            primitiveUnits="objectBoundingBox"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
            colorInterpolationFilters="linearRGB"
          >
            {/* <!-- 1) Fine monochrome noise --> */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.25"
              numOctaves="1"
              seed="9"
              result="noise"
            />
            <feColorMatrix in="noise" type="saturate" values="0" result="g" />

            {/* <!-- 2) Shape the noise -> mostly near 0 with occasional spikes (speckles) --> */}
            {/* <!--    gamma < 1 = more speckles; > 1 = fewer --> */}
            <feComponentTransfer in="g" result="mask">
              <feFuncR type="gamma" amplitude="1" exponent="0.65" offset="0" />
              <feFuncG type="gamma" amplitude="1" exponent="0.65" offset="0" />
              <feFuncB type="gamma" amplitude="1" exponent="0.65" offset="0" />
            </feComponentTransfer>

            {/* <!-- 3) Keep noise only where the element is opaque (transparent areas stay clean) --> */}
            <feComposite
              in="mask"
              in2="SourceAlpha"
              operator="in"
              result="maskedNoise"
            />

            {/* <!-- 4) Darken-only: out = SourceGraphic * (1 - strength * maskedNoise) --> */}
            {/* <!--    arithmetic: k1=-strength, k2=1, k3=0, k4=0 --> */}
            <feComposite
              in="SourceGraphic"
              in2="maskedNoise"
              operator="arithmetic"
              k1="-1"
              k2="1"
              k3="0"
              k4="0"
            />
          </filter>
        </defs>
      </svg>
    </>
  );
}
